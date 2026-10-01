import type { BBox } from "./types";

/** Deterministic-but-unique ids. Uses crypto.randomUUID when available. */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Mark glyphs that carry answer evidence and must be removed from option text. */
export const CHECK_GLYPHS = ["✓", "✔", "☑", "✅", "🗸"];
export const CROSS_GLYPHS = ["✕", "✖", "✗", "✘", "×", "☒", "❌", "⨯"];

const PUA_RE = /[\uE000-\uF8FF]/g;

export function isPrivateUseGlyph(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0xe000 && cp <= 0xf8ff;
}

/**
 * Display normalization: keeps math structure (superscripts, subscripts,
 * Greek letters, operators, units). Only whitespace and invisible chars are
 * touched. Never rewrites 10⁻⁹ into 109.
 */
export function cleanDisplayText(s: string): string {
  return s
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])(\s|$)/g, "$1$2")
    .trim();
}

/** Removes mark glyphs (✓ ✕ PUA icons) from a string, returns stripped text and the glyphs. */
export function stripMarkGlyphs(s: string): { text: string; glyphs: string[] } {
  const glyphs: string[] = [];
  let out = "";
  for (const ch of s) {
    if (CHECK_GLYPHS.includes(ch) || CROSS_GLYPHS.includes(ch) || isPrivateUseGlyph(ch)) {
      // "×" is also multiplication: only treat as mark at the boundaries of the string
      if (ch === "×") {
        out += "\u0000";
        continue;
      }
      glyphs.push(ch);
      continue;
    }
    out += ch;
  }
  // Resolve × placeholders: boundary → mark, interior (between digits/letters) → keep as operator
  const trimmed = out.trim();
  let result = "";
  const chars = [...trimmed];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "\u0000") {
      result += chars[i];
      continue;
    }
    const before = chars.slice(0, i).join("").trim();
    const after = chars.slice(i + 1).join("").replace(/\u0000/g, "").trim();
    if (!before || !after) glyphs.push("×");
    else result += "×";
  }
  return { text: cleanDisplayText(result.replace(PUA_RE, "")), glyphs };
}

/**
 * Identity normalization used for deduplication only. Lowercases, unifies
 * look-alike letters (Latin/Cyrillic), ё→е, strips punctuation but keeps
 * digits, superscripts and Greek letters so formulas still discriminate.
 */
export function normalizeForMatch(s: string): string {
  const confusables: Record<string, string> = {
    a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", b: "в", h: "н",
  };
  const lower = stripMarkGlyphs(s).text.toLowerCase().replace(/ё/g, "е");
  // Only fold Latin look-alikes inside words that are otherwise Cyrillic.
  const folded = lower.replace(/[\p{L}]+/gu, (word) => {
    const hasCyr = /[\u0400-\u04FF]/.test(word);
    const hasLat = /[a-z]/.test(word);
    if (hasCyr && hasLat) return [...word].map((ch) => confusables[ch] ?? ch).join("");
    return word;
  });
  return folded
    .replace(/[«»"“”„'`’‘()\[\]{}]/g, " ")
    .replace(/[.,;:!?…–—\-_/\\|*#~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalizeForMatch(s).split(" ").filter((t) => t.length > 0);
}

export function trigrams(s: string): Set<string> {
  const n = ` ${normalizeForMatch(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < n.length - 2; i++) out.add(n.slice(i, i + 3));
  return out;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Parses "1,00" / "0.5" / "604" → number. */
export function parseLocaleNumber(s: string): number | null {
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export function unionBBox(boxes: (BBox | null | undefined)[]): BBox | null {
  const list = boxes.filter((b): b is BBox => !!b);
  if (list.length === 0) return null;
  const x1 = Math.min(...list.map((b) => b.x));
  const y1 = Math.min(...list.map((b) => b.y));
  const x2 = Math.max(...list.map((b) => b.x + b.w));
  const y2 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n",
};
const SUBSCRIPT_MAP: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
};
const GREEK_LATEX: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", η: "\\eta", θ: "\\theta",
  λ: "\\lambda", μ: "\\mu", ν: "\\nu", π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau", φ: "\\varphi",
  ω: "\\omega", Δ: "\\Delta", Ω: "\\Omega", Φ: "\\Phi", Σ: "\\Sigma",
};

/**
 * Best-effort, lossless-in-spirit LaTeX rendering of a Unicode formula.
 * Returns null when the input contains nothing math-specific (no point
 * pretending we "recognized" something).
 */
export function toLatex(raw: string): string | null {
  let changed = false;
  let out = "";
  const chars = [...raw];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (SUPERSCRIPT_MAP[ch]) {
      let run = "";
      while (i < chars.length && SUPERSCRIPT_MAP[chars[i]]) run += SUPERSCRIPT_MAP[chars[i++]];
      i--;
      out += `^{${run}}`;
      changed = true;
    } else if (SUBSCRIPT_MAP[ch]) {
      let run = "";
      while (i < chars.length && SUBSCRIPT_MAP[chars[i]]) run += SUBSCRIPT_MAP[chars[i++]];
      i--;
      out += `_{${run}}`;
      changed = true;
    } else if (GREEK_LATEX[ch]) {
      out += `${GREEK_LATEX[ch]} `;
      changed = true;
    } else if (ch === "·" || ch === "⋅") {
      out += "\\cdot ";
      changed = true;
    } else if (ch === "√") {
      out += "\\sqrt ";
      changed = true;
    } else if (ch === "≈") {
      out += "\\approx ";
      changed = true;
    } else if (ch === "≤") {
      out += "\\le ";
      changed = true;
    } else if (ch === "≥") {
      out += "\\ge ";
      changed = true;
    } else if (ch === "∞") {
      out += "\\infty ";
      changed = true;
    } else {
      out += ch;
    }
  }
  return changed ? out.replace(/\s+/g, " ").trim() : null;
}

/** Heuristic: does this text contain a formula / quantitative expression? */
export function looksLikeFormula(s: string): boolean {
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺₀₁₂₃₄₅₆₇₈₉√∫∑∆∂≈≤≥∞·⋅]/.test(s)) return true;
  if (/(?<![A-Za-zА-Яа-я])[A-Za-zА-Яа-яα-ωΑ-Ω]{1,3}\s*=\s*[A-Za-zА-Яа-яα-ωΑ-Ω0-9(]/.test(s)) return true;
  if (/\d\s*[*×·]\s*10\s*[\^⁻-]?\s*-?\d/.test(s)) return true;
  if (/\b\d+(?:[.,]\d+)?\s*(?:нм|мкм|мм|см|км|мс|мкс|кГц|МГц|Гц|Дж|Вт|Па|кПа|мм рт\.? ?ст|Ом|В|А|Тл|Кл|Ф|Гн|nm|μm|mm|cm|Hz|kHz|MHz|J|W|Pa|Ohm|V|mV|mA|dB|дБ|эВ|eV)(?![A-Za-zА-Яа-я])/.test(s)) return true;
  return false;
}

/**
 * Suspicious OCR / text-layer damage in formulas: "10-9" style exponents where
 * the minus/superscript was likely lost, or "Ом·м" turned into garbage.
 */
export function formulaDamageSignals(s: string): string[] {
  const out: string[] = [];
  if (/\b10\s?-\s?\d{1,2}\b/.test(s) && !/10\s?[⁻^]/.test(s)) out.push("exponent-may-be-flattened");
  if (/\b10\d{2}\b/.test(s) && /(?:м|m|Гц|Hz|Дж|J)(?![A-Za-zА-Яа-я])/.test(s)) out.push("exponent-digits-merged");
  if (/[�]/.test(s)) out.push("replacement-char");
  return out;
}
