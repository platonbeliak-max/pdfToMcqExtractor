import type { ConfidenceLevel, MCQQuestion } from "@/types/question";
import type { CanonicalQuestionDraft, PageInput, QuestionInstance } from "./types";
import { aggregate } from "./canonical";
import {
  FIGURE_PROMPT,
  FIGURE_TAG,
  detectFigures,
  detectOcrFigures,
  figureNoise,
  mergeFigures,
  type FigureDraft,
  type MergedFigure,
} from "./figures";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

import { stripScoreNoise } from "./noise";

export { stripScoreNoise };

const STATUS_BAR_RE = /°\s?[CС]|mostly\s+(?:cloudy|sunny)|partly\s+cloudy|\b(?:LTE|4G|5G)\b|\d{1,3}\s?%\s*$/i;

/**
 * Text OCR'd from phone screenshots and anatomy pictures: status-bar
 * fragments, mixed-script tokens ("ErEE", "bunpuL") and stray symbols.
 * Such stems are not questions, and if kept they swallow neighbouring
 * questions' answers.
 */
export function isOcrGarbage(stem: string): boolean {
  if (STATUS_BAR_RE.test(stem)) return true;
  const tokens = stem.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const cyr = (stem.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const lat = (stem.match(/\p{Script=Latin}/gu) ?? []).length;
  const cyrillicText = cyr > lat;
  let junk = 0;
  for (const tok of tokens) {
    const word = tok.replace(/^[«"'(\[]+|[»"'),.:;!?\]]+$/g, "");
    if (!word) continue;
    const hasCyr = /\p{Script=Cyrillic}/u.test(word);
    const hasLat = /\p{Script=Latin}/u.test(word);
    const hasLetter = /\p{L}/u.test(word);
    if (hasCyr && hasLat) junk++;
    else if (!hasLetter && !/^\d+(?:[.,)]\d*)?$/.test(word) && !/^[—–-]$/.test(word)) junk++;
    else if (cyrillicText && hasLat && word.length <= 4) junk++;
  }
  return junk / tokens.length > 0.22;
}

/**
 * Picture captions and label lists ("1. 2. нервы 3. нерв…") end up as stems
 * that make no sense without the image. They stay in the bank but are flagged
 * and kept out of tests.
 */
export function isUnreadableStem(stem: string): boolean {
  const letters = (stem.match(/\p{L}/gu) ?? []).length;
  if (letters < 8) return true;
  const words = stem.match(/\p{L}{2,}/gu) ?? [];
  if (words.length < 2) return true;
  const enumMarks = (stem.match(/(?:^|\s)\d{1,2}[.)](?=\s|$)/g) ?? []).length;
  if (enumMarks >= 2 && enumMarks * 2 >= words.length) return true;
  const nonSpace = stem.replace(/\s/g, "").length;
  if (nonSpace && letters / nonSpace < 0.45) return true;
  const avg = words.reduce((s, w) => s + w.length, 0) / words.length;
  return avg < 2.6;
}

function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "needs-review";
}

function canonicalToMcq(c: CanonicalQuestionDraft, index: number, byId: Map<string, QuestionInstance>): MCQQuestion {
  const options: Record<string, string> = {};
  const keyByCanonicalKey = new Map<string, string>();
  c.options.forEach((o, i) => {
    const key = LETTERS[i] ?? String(i + 1);
    options[key] = stripScoreNoise(o.text);
    keyByCanonicalKey.set(o.key, key);
  });

  const correctKeys = c.correctKeys
    .map((k) => keyByCanonicalKey.get(k))
    .filter((k): k is string => !!k)
    .sort();

  let textual: string | undefined;
  if (c.textAnswer) textual = c.textAnswer;
  else if (c.matching) {
    textual = Object.entries(c.matching)
      .map(([k, v]) => `${options[keyByCanonicalKey.get(k) ?? ""] ?? k} → ${v}`)
      .join("; ");
  } else if (c.correctOrder?.length) {
    textual = c.correctOrder.map((k) => options[keyByCanonicalKey.get(k) ?? ""] ?? k).join(" → ");
  }

  const correctAnswer = correctKeys.length ? correctKeys.join(",") : null;
  const answerText = correctKeys.length ? correctKeys.map((k) => options[k]).join("; ") : textual;
  const hasAnswer = !!correctAnswer || !!textual;
  const conflict = c.conflicts.length > 0;
  const level = confidenceLevel(c.confidence);
  const first = byId.get(c.instanceIds[0]);
  const stem = stripScoreNoise(c.stem);
  const unreadable = isUnreadableStem(stem) || isOcrGarbage(stem);

  return {
    id: c.key,
    number: index + 1,
    question: stem,
    options,
    correctAnswer,
    answerText,
    confidence: !hasAnswer || conflict || unreadable ? "needs-review" : level,
    status: !hasAnswer ? "missing_answer" : conflict || unreadable || level === "needs-review" ? "needs_review" : "answered",
    tags: unreadable ? ["unreadable"] : undefined,
    pageNumber: first?.physicalPage,
    explanation: first?.feedback ?? undefined,
    attempts: c.instanceIds.length,
  };
}

export function buildQuestions(all: QuestionInstance[]): { questions: MCQQuestion[]; totalFound: number } {
  const instances = all.filter((i) => i.stem.trim());
  let n = 0;
  const { canonicals } = aggregate(instances, [], () => `q${Date.now().toString(36)}${(n++).toString(36)}`);
  const byId = new Map(instances.map((i) => [i.id, i]));
  const ordered = canonicals
    .slice()
    .sort((a, b) => (byId.get(a.instanceIds[0])?.sequence ?? 0) - (byId.get(b.instanceIds[0])?.sequence ?? 0));
  // Noise without an answer (screenshots, picture labels) is not a question; noise that carries an answer stays flagged.
  const questions = ordered
    .map((c, i) => canonicalToMcq(c, i, byId))
    .filter((q) => !(q.tags?.includes("unreadable") && q.status === "missing_answer"))
    .map((q, i) => ({ ...q, number: i + 1 }));
  return { questions, totalFound: instances.length };
}

/**
 * Runs the universal ingestion engine in the browser, merges repeated
 * questions (many attempts of the same test) into unique ones and pools the
 * answer evidence from every attempt.
 */
export async function extractWithEngine(
  data: ArrayBuffer,
  opts: { ocr?: "auto" | "force" | "off"; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ questions: MCQQuestion[]; pageCount: number; totalFound: number }> {
  const [{ openPdf, extractPages, renderRegion }, { analyzeDocument }, { putImage }] = await Promise.all([
    import("./client-extract"),
    import("./pipeline"),
    import("../figure-store"),
  ]);
  const doc = await openPdf(data.slice(0));
  const pages: PageInput[] = [];
  for await (const page of extractPages(doc, { ocr: opts.ocr ?? "auto", ocrLang: "rus+eng" })) {
    pages.push(page);
    opts.onProgress?.(page.pageNumber, doc.numPages);
  }

  const drafts = [...detectFigures(pages), ...detectOcrFigures(pages)];
  const hashes: (string | null)[] = [];
  for (const d of drafts) {
    const r = await renderRegion(doc, d.imagePage, d.bbox, d.maskBoxes, 160).catch(() => null);
    hashes.push(r?.hash || null);
  }
  const merged = mergeFigures(drafts, hashes);
  const figureQs: MCQQuestion[] = [];
  for (const m of merged) {
    const d = drafts[m.primary];
    const id = `fig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const img = await renderRegion(doc, d.imagePage, d.bbox, d.maskBoxes).catch(() => null);
    let imageId: string | undefined;
    if (img) {
      await putImage(id, img.blob)
        .then(() => (imageId = id))
        .catch(() => undefined);
    }
    figureQs.push(figureToMcq(m, drafts, imageId));
  }
  await doc.cleanup?.();

  const analysis = analyzeDocument(pages, { documentId: "local" });
  const { questions: textQs, totalFound } = buildQuestions(analysis.instances);
  const isFigureNoise = figureNoise(drafts);
  const questions = [...textQs.filter((q) => !isFigureNoise(q)), ...figureQs].map((q, i) => ({ ...q, number: i + 1 }));
  return { questions, pageCount: doc.numPages, totalFound: totalFound + drafts.length };
}

function figureToMcq(m: MergedFigure, drafts: FigureDraft[], imageId: string | undefined): MCQQuestion {
  const d = drafts[m.primary];
  const options: Record<string, string> = {};
  for (const l of m.labels) options[String(l.n)] = l.text;
  const doubtful = m.labels.filter((l) => !l.agreed).map((l) => l.n);
  const sure = doubtful.length === 0;
  const explanation = sure
    ? undefined
    : d.fromOcr
      ? "Подписи распознаны с картинки — проверьте / Captions were OCR-read from the picture — please check"
      : `Проверьте подписи: ${doubtful.join(", ")} — попытка без полного балла / Check labels ${doubtful.join(", ")}: no full-score attempt`;
  return {
    id: imageId ?? `fig-${Math.random().toString(36).slice(2, 12)}`,
    number: 0,
    question: FIGURE_PROMPT,
    options,
    correctAnswer: m.labels.map((l) => String(l.n)).join(","),
    answerText: m.labels.map((l) => `${l.n} — ${l.text}`).join("; "),
    confidence: sure ? "high" : "needs-review",
    status: sure ? "answered" : "needs_review",
    tags: [FIGURE_TAG],
    pageNumber: d.imagePage,
    explanation,
    attempts: m.drafts.length,
    imageId,
  };
}
