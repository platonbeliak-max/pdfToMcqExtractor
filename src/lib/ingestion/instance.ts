import type {
  AnswerOption,
  ClassifiedLine,
  FormulaAsset,
  ImageAsset,
  QuestionInstance,
  RawImageRegion,
  ScoreInfo,
  TableAsset,
  VisualMark,
} from "./types";
import type { OptionMeta } from "./classify";
import type { RawBlock } from "./segment";
import {
  CHECK_GLYPHS,
  CROSS_GLYPHS,
  cleanDisplayText,
  formulaDamageSignals,
  isPrivateUseGlyph,
  looksLikeFormula,
  normalizeForMatch,
  stripLmsChrome,
  stripMarkGlyphs,
  toLatex,
  unionBBox,
  uuid,
} from "./text";
import { detectQuestionType } from "./qtype";

const SELECTED_BULLETS = ["●", "◉", "☑", "■", "⬤", "☒"];
const UNSELECTED_BULLETS = ["○", "◦", "☐", "□", "◯", "◎"];

function glyphToMarkType(g: string): VisualMark["type"] {
  if (CHECK_GLYPHS.includes(g)) return "CHECKMARK";
  if (CROSS_GLYPHS.includes(g)) return "CROSS";
  if (isPrivateUseGlyph(g)) return "UNKNOWN_GLYPH";
  return "UNKNOWN_GLYPH";
}

function scoreFrom(line: ClassifiedLine, statusText: string | null): ScoreInfo {
  const earned = (line.meta?.earned as number | null) ?? null;
  const max = (line.meta?.max as number | null) ?? null;
  return buildScore(earned, max, statusText, String(line.meta?.raw ?? line.text), line.page, line.bbox);
}

export function buildScore(
  earned: number | null,
  max: number | null,
  statusText: string | null,
  raw: string,
  page: number,
  bbox: ScoreInfo["bbox"],
): ScoreInfo {
  let kind: ScoreInfo["kind"] = "UNKNOWN";
  if (earned !== null && max !== null && max > 0) {
    if (Math.abs(earned - max) < 1e-6) kind = "FULL_SCORE";
    else if (earned <= 1e-6) kind = "ZERO_SCORE";
    else kind = "PARTIAL_SCORE";
  }
  let grade: ScoreInfo["grade"] = "UNKNOWN";
  const s = (statusText ?? "").toLowerCase();
  if (/частично|partially/.test(s)) grade = "PARTIAL";
  else if (/^(неверно|incorrect)$/.test(s)) grade = "INCORRECT";
  else if (/^(верно|correct)$/.test(s)) grade = "CORRECT";
  else if (/нет\s+ответа|не\s+отвечено|not\s+(?:yet\s+)?answered/.test(s)) grade = "UNANSWERED";
  if (kind === "UNKNOWN") {
    if (grade === "CORRECT") kind = "FULL_SCORE";
    else if (grade === "INCORRECT") kind = "ZERO_SCORE";
    else if (grade === "PARTIAL") kind = "PARTIAL_SCORE";
    else if (grade === "UNANSWERED") kind = "UNANSWERED";
  }
  if (grade === "UNKNOWN") {
    if (kind === "FULL_SCORE") grade = "CORRECT";
    else if (kind === "ZERO_SCORE") grade = "INCORRECT";
    else if (kind === "PARTIAL_SCORE") grade = "PARTIAL";
  }
  return { earned, max, kind, grade, raw, page, bbox };
}

/** Groups unlabeled text lines into options by vertical rhythm (wrap vs. new item). */
function groupUnlabeled(lines: ClassifiedLine[]): ClassifiedLine[][] {
  if (lines.length <= 1) return lines.map((l) => [l]);
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    gaps.push(a.page === b.page ? b.bbox.y - (a.bbox.y + a.bbox.h) : 999);
  }
  const maxGap = Math.max(...gaps.filter((g) => g < 999), 0);
  const minGap = Math.min(...gaps);
  const varied = maxGap - minGap > Math.max(lines[0].bbox.h * 0.35, 2);
  const groups: ClassifiedLine[][] = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    const g = gaps[i - 1];
    if (varied && g < maxGap * 0.6 && g < 999) groups[groups.length - 1].push(lines[i]);
    else groups.push([lines[i]]);
  }
  return groups;
}

export interface InstanceBuildContext {
  documentId: string;
  attemptId: string;
  attemptStartPage: number;
  sequence: number;
  pageImages: Map<number, RawImageRegion[]>;
}

/**
 * Turns a raw block into a QuestionInstance. Answer determination is done
 * separately (answer.ts) once document-level glyph meanings are known.
 */
export function buildInstance(block: RawBlock, ctx: InstanceBuildContext): QuestionInstance {
  const issues: string[] = [];
  const lines = block.lines;
  const header = lines[0].role === "QUESTION_HEADER" ? lines[0] : null;

  const stemParts: string[] = [];
  if (header?.meta?.inline) stemParts.push(String(header.meta.inline));

  let statusText: string | null = null;
  let scoreLine: ClassifiedLine | null = null;
  let instruction: string | null = null;
  let instructionMulti: boolean | null = null;
  let instructionKind: string | null = null;
  const feedbackParts: string[] = [];
  const optionLines: { meta: OptionMeta | null; lines: ClassifiedLine[] }[] = [];
  const unlabeledAfterInstruction: ClassifiedLine[] = [];
  const markOnly: ClassifiedLine[] = [];
  let phase: "stem" | "instruction" | "options" | "feedback" = "stem";

  for (const l of lines) {
    if (l === header) continue;
    switch (l.role) {
      case "STATUS":
        statusText = statusText ?? l.text;
        break;
      case "SCORE":
        scoreLine = scoreLine ?? l;
        break;
      case "FLAG":
      case "NOISE":
      case "ATTEMPT_META":
        break;
      case "INSTRUCTION":
        if (!instruction) {
          instruction = l.text;
          instructionMulti = (l.meta?.multi as boolean | null) ?? null;
          instructionKind = (l.meta?.kind as string | null) ?? null;
        }
        if (phase === "stem") phase = "instruction";
        break;
      case "FEEDBACK":
        phase = "feedback";
        feedbackParts.push(l.text);
        break;
      case "MARK_ONLY":
        markOnly.push(l);
        break;
      case "OPTION":
        if (phase === "feedback") {
          feedbackParts.push(l.text);
          break;
        }
        phase = "options";
        optionLines.push({ meta: l.meta as unknown as OptionMeta, lines: [l] });
        break;
      case "QUESTION_HEADER":
        // A weak header inside a block = numbered sub-item; treat as option.
        phase = "options";
        optionLines.push({
          meta: { kind: "NUMBER", label: String(l.meta?.number ?? ""), number: (l.meta?.number as number) ?? null, sign: null, code: null, text: String(l.meta?.inline ?? l.text), glyphs: [], bulletGlyph: null },
          lines: [l],
        });
        break;
      default: {
        if (phase === "stem") stemParts.push(l.text);
        else if (phase === "instruction") unlabeledAfterInstruction.push(l);
        else if (phase === "options") {
          const last = optionLines[optionLines.length - 1];
          if (last) last.lines.push(l);
        } else feedbackParts.push(l.text);
      }
    }
  }

  // Options without labels (radio circles lost in the print): use vertical rhythm.
  if (optionLines.length === 0 && unlabeledAfterInstruction.length > 0) {
    for (const g of groupUnlabeled(unlabeledAfterInstruction)) optionLines.push({ meta: null, lines: g });
    issues.push("UNLABELED_OPTIONS");
  } else if (unlabeledAfterInstruction.length > 0) {
    stemParts.push(...unlabeledAfterInstruction.map((l) => l.text));
  }

  // If no instruction and no labeled options, but several short lines after the stem
  // look like an LMS answer list, keep them in the stem (do not invent options).

  const marks: VisualMark[] = [];
  const options: AnswerOption[] = optionLines.map((ol, idx) => {
    const id = uuid();
    const first = ol.lines[0];
    const meta = ol.meta;
    const firstText = meta ? meta.text : first.text;
    const restRaw = ol.lines.slice(1).map((l) => l.text);
    const glyphs: string[] = [...(meta?.glyphs ?? [])];
    const restClean = restRaw.map((t) => {
      const s = stripMarkGlyphs(t);
      glyphs.push(...s.glyphs);
      return s.text;
    });
    const stripped = stripMarkGlyphs(firstText);
    glyphs.push(...stripped.glyphs);
    const rawText = ol.lines.map((l) => l.text).join(" ");
    let text = cleanDisplayText([stripped.text, ...restClean].join(" ").replace(/[⟪⟫]/g, ""));

    let pairText: string | null = null;
    const pairMatch = text.match(/^(.{2,}?)\s*(?:→|->|⇒|—>|=>)\s*(.{1,})$/);
    if (pairMatch) {
      text = pairMatch[1].trim();
      pairText = pairMatch[2].trim();
    }

    const bbox = unionBBox(ol.lines.map((l) => l.bbox));
    for (const g of glyphs) {
      marks.push({ id: uuid(), type: glyphToMarkType(g), rawGlyph: g, page: first.page, bbox: first.cells[first.cells.length - 1]?.bbox ?? first.bbox, associatedOptionId: id, confidence: isPrivateUseGlyph(g) ? 0.5 : 0.95, source: first.source === "OCR" ? "OCR" : "TEXT_LAYER" });
    }
    if (meta?.kind === "PLUS_MINUS") {
      marks.push({ id: uuid(), type: meta.sign === "+" ? "PLUS" : "MINUS", rawGlyph: `${meta.sign}{${meta.code}}`, page: first.page, bbox: first.bbox, associatedOptionId: id, confidence: 0.97, source: first.source === "OCR" ? "OCR" : "TEXT_LAYER" });
    }
    if (meta?.bulletGlyph && SELECTED_BULLETS.includes(meta.bulletGlyph)) {
      marks.push({ id: uuid(), type: "SELECTED", rawGlyph: meta.bulletGlyph, page: first.page, bbox: first.bbox, associatedOptionId: id, confidence: 0.85, source: first.source === "OCR" ? "OCR" : "TEXT_LAYER" });
    }
    void UNSELECTED_BULLETS;

    return {
      id,
      label: meta?.label ?? null,
      position: idx,
      rawText,
      text,
      normalizedText: normalizeForMatch(text),
      page: first.page,
      bbox,
      pairText,
      orderIndex: meta?.kind === "BRACKET" ? meta.number : null,
    };
  });

  // Glyph-only lines: attach to the option on the same baseline.
  for (const ml of markOnly) {
    const yc = ml.bbox.y + ml.bbox.h / 2;
    let best: AnswerOption | null = null;
    let bestD = Infinity;
    for (const o of options) {
      if (!o.bbox || o.page !== ml.page) continue;
      const d = Math.abs(o.bbox.y + o.bbox.h / 2 - yc);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    const tolerance = Math.max(ml.bbox.h, 8) * 1.2;
    for (const g of (ml.meta?.glyphs as string[]) ?? []) {
      marks.push({
        id: uuid(),
        type: glyphToMarkType(g),
        rawGlyph: g,
        page: ml.page,
        bbox: ml.bbox,
        associatedOptionId: best && bestD <= tolerance ? best.id : null,
        confidence: best && bestD <= tolerance ? (isPrivateUseGlyph(g) ? 0.5 : 0.85) : 0.2,
        source: ml.source === "OCR" ? "OCR" : "TEXT_LAYER",
      });
    }
    if (!best || bestD > tolerance) issues.push("MARK_NOT_ASSOCIATED");
  }

  // ⟪…⟫ wraps text the extractor found inside an LMS answer field: that's the
  // student's typed response, not part of the question.
  const stemRaw = stemParts.join(" ").replace(/⟫\s*⟪/g, " ");
  const responses = [...stemRaw.matchAll(/⟪([^⟫]*)⟫/g)].map((m) => cleanDisplayText(m[1])).filter(Boolean);
  const studentResponse = responses.length ? responses.join(" ") : null;
  const stem = stripLmsChrome(cleanDisplayText(stripMarkGlyphs(stemRaw.replace(/⟪[^⟫]*⟫/g, " ").replace(/[⟪⟫]/g, "")).text));

  // Tables: ≥2 consecutive lines with the same (≥2) cell count.
  const tables: TableAsset[] = [];
  let run: ClassifiedLine[] = [];
  const flushRun = () => {
    if (run.length >= 2) {
      tables.push({
        id: uuid(),
        page: run[0].page,
        bbox: unionBBox(run.map((r) => r.bbox))!,
        rows: run.map((r) => ({ cells: r.cells.map((c) => ({ text: c.text, bbox: c.bbox })) })),
      });
    }
    run = [];
  };
  for (const l of lines) {
    if (l.cells.length >= 2 && l.role !== "QUESTION_HEADER" && (!run.length || run[run.length - 1].cells.length === l.cells.length)) run.push(l);
    else {
      flushRun();
      if (l.cells.length >= 2) run.push(l);
    }
  }
  flushRun();

  // Formulas
  const formulas: FormulaAsset[] = [];
  for (const l of lines) {
    if (l.role === "NOISE" || l.role === "SCORE" || l.role === "ATTEMPT_META") continue;
    if (!looksLikeFormula(l.text)) continue;
    const damage = formulaDamageSignals(l.text);
    formulas.push({ id: uuid(), page: l.page, bbox: l.bbox, raw: l.text, latex: toLatex(l.text), confidence: l.source === "OCR" ? Math.min(l.conf, 0.7) : damage.length ? 0.6 : 0.95, source: l.source });
    if (l.source === "OCR") issues.push("FORMULA_FROM_OCR");
    for (const d of damage) issues.push(`FORMULA_${d.toUpperCase().replace(/-/g, "_")}`);
  }

  // Images: overlap with block's vertical span on each page.
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  const images: ImageAsset[] = [];
  const labelRef = stem.match(/(?:цифр(?:ой|ами)|номер(?:ом)?|под\s+номером|number)\s*(\d{1,3})/i)?.[1] ?? null;
  for (const p of pages) {
    const pageLines = lines.filter((l) => l.page === p && l.role !== "NOISE");
    if (!pageLines.length) continue;
    const top = Math.min(...pageLines.map((l) => l.bbox.y));
    // When the question continues on a later page, everything below its last
    // line on this page (typically the figure) still belongs to it.
    const continues = p !== pages[pages.length - 1];
    const bottom = continues ? Number.POSITIVE_INFINITY : Math.max(...pageLines.map((l) => l.bbox.y + l.bbox.h));
    for (const img of ctx.pageImages.get(p) ?? []) {
      const yc = img.bbox.y + img.bbox.h / 2;
      if (yc >= top - 4 && yc <= bottom + 4) {
        images.push({ id: uuid(), page: p, bbox: img.bbox, referencedLabel: labelRef });
      }
    }
  }

  const ocrLines = lines.filter((l) => l.source === "OCR");
  const ocrConf = ocrLines.length ? ocrLines.reduce((s, l) => s + l.conf, 0) / ocrLines.length : 1;

  const type = detectQuestionType({
    stem,
    instructionMulti,
    instructionKind,
    options,
    optionKinds: optionLines.map((o) => o.meta?.kind ?? "UNLABELED"),
    marks,
    hasImage: images.length > 0,
    hasTable: tables.length > 0,
    hasFormula: formulas.length > 0,
    feedbackText: feedbackParts.join(" ") || null,
    plusCount: marks.filter((m) => m.type === "PLUS").length,
  });

  const score = scoreLine ? scoreFrom(scoreLine, statusText) : statusText ? buildScore(null, null, statusText, statusText, lines[0].page, null) : null;

  if (!stem) issues.push("EMPTY_STEM");
  if (options.length === 1) issues.push("SINGLE_OPTION");
  if (options.length === 0 && !["SHORT_TEXT", "NUMERIC", "FORMULA", "TABLE"].includes(type.type)) issues.push("NO_OPTIONS");
  if (ocrConf < 0.75) issues.push("LOW_OCR_CONFIDENCE");
  const normOpts = options.map((o) => o.normalizedText);
  if (new Set(normOpts).size !== normOpts.length) issues.push("DUPLICATE_OPTIONS");
  if (options.some((o) => !o.text)) issues.push("EMPTY_OPTION");
  if (block.headerless && block.openedBy === "preamble-promoted") issues.push("BOUNDARY_UNCERTAIN");
  if (type.type === "IMAGE_IDENTIFICATION" && images.length === 0) issues.push("IMAGE_REFERENCED_BUT_NOT_FOUND");

  const extractionConfidence = Math.max(
    0,
    Math.min(
      1,
      (stem ? 0.45 : 0) +
        (options.length >= 2 ? 0.35 : options.length === 0 && ["SHORT_TEXT", "NUMERIC"].includes(type.type) ? 0.25 : 0.05) +
        0.2 * type.confidence -
        (issues.includes("UNLABELED_OPTIONS") ? 0.1 : 0) -
        (issues.includes("BOUNDARY_UNCERTAIN") ? 0.15 : 0) -
        (1 - ocrConf) * 0.5,
    ),
  );

  return {
    id: uuid(),
    documentId: ctx.documentId,
    attemptId: ctx.attemptId,
    physicalPage: lines[0].page,
    pages,
    internalPage: lines[0].page - ctx.attemptStartPage + 1,
    questionNumber: block.headerNumber,
    sequence: ctx.sequence,
    rawText: lines.map((l) => l.text).join("\n").replace(/[⟪⟫]/g, ""),
    stem,
    studentResponse,
    normalizedStem: normalizeForMatch(stem),
    instruction,
    questionType: type.type,
    questionTypeConfidence: type.confidence,
    questionTypeSignals: type.signals,
    options,
    score,
    visualMarks: marks,
    evidence: [],
    images,
    tables,
    formulas,
    feedback: feedbackParts.length ? cleanDisplayText(feedbackParts.join(" ")) : null,
    answer: {
      correctOptionIds: [],
      incorrectOptionIds: [],
      selectedOptionIds: [],
      correctOrder: null,
      matching: null,
      textAnswer: null,
      complete: false,
      status: "UNRESOLVED",
      confidence: 0,
      reasons: [],
    },
    bbox: unionBBox(lines.filter((l) => l.page === lines[0].page).map((l) => l.bbox)),
    lineIds: lines.map((l) => l.id),
    confidence: Number(extractionConfidence.toFixed(2)),
    extractionStatus: "PARSED",
    issues,
    subjectHints: [],
  };
}
