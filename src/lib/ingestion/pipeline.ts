import type {
  ClassifiedLine,
  CoverageAudit,
  DocumentAnalysis,
  DocumentProfile,
  PageInput,
  ProcessingIssue,
  QuestionInstance,
  QuestionType,
  RawImageRegion,
  SourceType,
  TestAttempt,
} from "./types";
import { buildLines, detectRunningNoise } from "./layout";
import { classifyLine } from "./classify";
import { segment } from "./segment";
import { buildInstance } from "./instance";
import { repairSequence } from "./repair";
import { applyGlyphMeanings, determineAnswer, learnGlyphMeanings } from "./answer";
import { adapterFor, detectSubject, questionSubjectHints } from "./subjects";

export const ENGINE_VERSION = "ingest-2.0.0";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function detectLanguages(text: string): string[] {
  const out: string[] = [];
  const cyr = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  const ben = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  const total = cyr + lat + ben || 1;
  if (cyr / total > 0.1) out.push(/[іїєґ]/i.test(text) ? "uk" : "ru");
  if (lat / total > 0.1) out.push("en");
  if (ben / total > 0.1) out.push("bn");
  return out;
}

function buildProfile(
  pages: PageInput[],
  lines: ClassifiedLine[],
  instances: QuestionInstance[],
  attempts: TestAttempt[],
): DocumentProfile {
  const count = (role: string) => lines.filter((l) => l.role === role).length;
  const textLayerPages = pages.filter((p) => p.source === "TEXT_LAYER" && p.items.length > 0).length;
  const ocrPages = pages.filter((p) => p.source === "OCR").length;
  const emptyPages = pages.filter((p) => p.items.length === 0).length;
  const headers = count("QUESTION_HEADER");
  const strongHeaders = lines.filter((l) => l.role === "QUESTION_HEADER" && l.meta?.strength === "strong").length;
  const scores = count("SCORE");
  const status = count("STATUS");
  const attemptMeta = count("ATTEMPT_META");
  const pm = instances.reduce((s, q) => s + q.visualMarks.filter((m) => m.type === "PLUS" || m.type === "MINUS").length, 0);
  const glyphMarks = instances.reduce((s, q) => s + q.visualMarks.filter((m) => !["PLUS", "MINUS"].includes(m.type)).length, 0);

  const signals = { headers, strongHeaders, scores, status, attemptMeta, plusMinus: pm, glyphMarks, ocrPages, emptyPages };
  let sourceType: SourceType = "UNKNOWN";
  let conf = 0.3;
  if (ocrPages > pages.length * 0.6) {
    sourceType = "SCANNED";
    conf = 0.8;
  } else if (strongHeaders >= 2 && (scores >= 2 || status >= 2) && attemptMeta >= 1) {
    sourceType = "MOODLE_EXPORT";
    conf = 0.9;
  } else if (strongHeaders >= 2 && (scores >= 2 || status >= 2)) {
    sourceType = "LMS_EXPORT";
    conf = 0.75;
  } else if (pm >= 4) {
    sourceType = "PLUS_MINUS_BANK";
    conf = 0.9;
  } else if (headers >= 2) {
    sourceType = "NUMBERED_LIST";
    conf = 0.65;
  }

  const allText = lines.map((l) => l.text).join(" ");
  const types = [...new Set(instances.map((q) => q.questionType))] as QuestionType[];

  return {
    sourceType,
    sourceTypeConfidence: conf,
    pageCount: pages.length,
    hasTextLayer: textLayerPages > 0,
    textLayerPages,
    ocrPages,
    emptyPages,
    hasImages: pages.some((p) => p.images.length > 0),
    hasScores: scores > 0 || status > 0,
    hasExplicitMarks: glyphMarks > 0,
    hasPlusMinusMarks: pm > 0,
    hasMultipleAttempts: attempts.length > 1,
    hasTables: instances.some((q) => q.tables.length > 0),
    hasFormulas: instances.some((q) => q.formulas.length > 0),
    languages: detectLanguages(allText),
    questionTypes: types,
    detectedSubject: detectSubject(instances),
    signals,
  };
}

function buildAudit(
  pages: PageInput[],
  lines: ClassifiedLine[],
  noiseIds: string[],
  preambleIds: string[],
  instances: QuestionInstance[],
): CoverageAudit {
  const assigned = new Set<string>();
  for (const q of instances) for (const id of q.lineIds) assigned.add(id);
  for (const id of preambleIds) assigned.add(id);
  const noise = new Set(noiseIds);
  const orphan = lines.filter((l) => !assigned.has(l.id) && !noise.has(l.id));

  const parsed = instances.filter((q) => q.extractionStatus === "PARSED").length;
  const review = instances.filter((q) => q.extractionStatus === "NEEDS_REVIEW").length;
  const failed = instances.filter((q) => q.extractionStatus === "FAILED").length;
  const scoreLines = lines.filter((l) => l.role === "SCORE");
  const scoreAttached = instances.filter((q) => q.score && q.score.max !== null).length;
  const marks = instances.reduce((s, q) => s + q.visualMarks.length, 0);
  const marksAttached = instances.reduce((s, q) => s + q.visualMarks.filter((m) => m.associatedOptionId).length, 0);
  const marksUnresolved = instances.reduce((s, q) => s + q.visualMarks.filter((m) => m.type === "UNKNOWN_GLYPH").length, 0);
  const images = pages.reduce((s, p) => s + p.images.length, 0);
  const imagesAttached = new Set(instances.flatMap((q) => q.images.map((i) => `${i.page}:${Math.round(i.bbox.x)}:${Math.round(i.bbox.y)}`))).size;

  const emptyPages = pages.filter((p) => p.items.length === 0).map((p) => p.pageNumber);
  const unreadable = pages.filter((p) => (p.readErrors?.length ?? 0) > 0 && p.items.length === 0).map((p) => p.pageNumber);

  const problems: string[] = [];
  const balanced = parsed + review + failed === instances.length;
  if (!balanced) problems.push("PARSED + NEEDS_REVIEW + FAILED != TOTAL");
  if (orphan.length) problems.push(`${orphan.length} строк(и) не привязаны ни к вопросу, ни к метаданным`);
  if (unreadable.length) problems.push(`Нечитаемые страницы: ${unreadable.join(", ")}`);
  const scoreBlocksInQuestions = instances.filter((q) => q.score && (q.score.earned !== null || q.score.max !== null)).length;
  if (scoreLines.length > scoreBlocksInQuestions) problems.push(`${scoreLines.length - scoreBlocksInQuestions} блок(ов) баллов без вопроса`);
  if (marks - marksAttached > 0) problems.push(`${marks - marksAttached} отметок не привязаны к вариантам`);
  if (images > imagesAttached) problems.push(`${images - imagesAttached} изображений не привязаны к вопросам`);

  const hardProblems = !balanced || unreadable.length > 0 || orphan.some((l) => l.text.length > 25);

  return {
    totalPages: pages.length,
    processedPages: pages.length,
    emptyPages,
    unreadablePages: unreadable,
    totalLines: lines.length,
    classifiedLines: lines.length,
    noiseLines: noise.size,
    assignedLines: assigned.size,
    orphanLines: orphan.length,
    totalDetected: instances.length,
    totalParsed: parsed,
    totalNeedsReview: review,
    totalFailed: failed,
    balanced,
    scoreBlocks: scoreLines.length,
    scoreBlocksAttached: scoreAttached,
    marks,
    marksAttached,
    marksUnresolved,
    images,
    imagesAttached,
    tables: instances.reduce((s, q) => s + q.tables.length, 0),
    formulas: instances.reduce((s, q) => s + q.formulas.length, 0),
    status: hardProblems ? "PROCESSING_INCOMPLETE" : "COMPLETE",
    problems,
  };
}

export interface AnalyzeOptions {
  documentId: string;
  /** User-chosen subject (optional — subject is otherwise auto-detected). */
  subjectSlug?: string | null;
}

/**
 * Full deterministic analysis of a document from page inputs. Pure: same
 * input → same structure (except generated ids). Safe to re-run at any time
 * against stored raw pages with a newer engine version.
 */
export function analyzeDocument(pagesIn: PageInput[], opts: AnalyzeOptions): DocumentAnalysis {
  const stageLog: DocumentAnalysis["stageLog"] = [];
  const issues: ProcessingIssue[] = [];
  const stage = <T,>(name: string, fn: () => T, detail: (r: T) => string): T => {
    const t0 = now();
    const r = fn();
    stageLog.push({ stage: name, ms: Math.round(now() - t0), detail: detail(r) });
    return r;
  };

  const pages = [...pagesIn].sort((a, b) => a.pageNumber - b.pageNumber);

  for (const p of pages) {
    for (const e of p.readErrors ?? []) issues.push({ stage: "PAGE_READ", page: p.pageNumber, severity: p.items.length ? "WARNING" : "ERROR", code: "PAGE_READ_ERROR", message: e });
    if (p.items.length === 0) issues.push({ stage: "TEXT_EXTRACTION", page: p.pageNumber, severity: "WARNING", code: "EMPTY_PAGE", message: "На странице не найден текст" });
  }

  const pageLines = stage(
    "LAYOUT_ANALYSIS",
    () => pages.map((p) => ({ page: p, lines: buildLines(p) })),
    (r) => `${r.reduce((s, x) => s + x.lines.length, 0)} строк`,
  );

  const runningNoise = detectRunningNoise(pageLines.map((x) => ({ lines: x.lines, height: x.page.height })));

  const classified = stage(
    "BLOCK_CLASSIFICATION",
    () => pageLines.flatMap((x) => x.lines.map((l) => classifyLine(l, { runningNoise }))),
    (r) => {
      const c: Record<string, number> = {};
      for (const l of r) c[l.role] = (c[l.role] ?? 0) + 1;
      return Object.entries(c).map(([k, v]) => `${k}:${v}`).join(" ");
    },
  );

  const seg = stage("QUESTION_DETECTION", () => segment(classified, opts.documentId), (r) => `${r.blocks.length} блоков, ${r.attempts.length} попыток`);
  issues.push(...seg.issues);

  const pageImages = new Map<number, RawImageRegion[]>(pages.map((p) => [p.pageNumber, p.images]));

  let instances = stage(
    "QUESTION_PARSING",
    () =>
      seg.blocks.map((b, i) => {
        const att = seg.attempts[b.attemptIndex] ?? seg.attempts[0];
        return buildInstance(b, { documentId: opts.documentId, attemptId: att.id, attemptStartPage: att.startPage, sequence: i + 1, pageImages });
      }),
    (r) => `${r.length} вопросов`,
  );

  instances = stage(
    "SEQUENCE_REPAIR",
    () => repairSequence(instances),
    (r) => `${r.length} вопросов после склейки страниц`,
  );

  const glyphs = stage("MARK_DETECTION", () => learnGlyphMeanings(instances), (r) => `${r.size} значков распознано по баллам`);
  instances = instances.map((q) => applyGlyphMeanings(q, glyphs));

  instances = stage(
    "ANSWER_EVIDENCE",
    () => instances.map(determineAnswer),
    (r) => {
      const c: Record<string, number> = {};
      for (const q of r) c[q.answer.status] = (c[q.answer.status] ?? 0) + 1;
      return Object.entries(c).map(([k, v]) => `${k}:${v}`).join(" ");
    },
  );

  // Subject adapters: hints + extra validation only.
  const autoSubject = detectSubject(instances);
  const adapter = adapterFor(opts.subjectSlug ?? autoSubject?.slug);
  instances = instances.map((q) => {
    const extra = adapter?.validate?.(q) ?? [];
    const hints = questionSubjectHints(q);
    const iss = [...new Set([...q.issues, ...extra])];
    return {
      ...q,
      subjectHints: hints,
      issues: iss,
      extractionStatus: extra.length && q.extractionStatus === "PARSED" ? "NEEDS_REVIEW" : q.extractionStatus,
    };
  });

  for (const q of instances) {
    if (q.extractionStatus !== "PARSED") {
      issues.push({ stage: "VALIDATION", page: q.physicalPage, severity: q.extractionStatus === "FAILED" ? "ERROR" : "WARNING", code: q.issues[0] ?? "LOW_CONFIDENCE", message: `Вопрос ${q.questionNumber ?? q.sequence}: ${q.issues.join(", ") || "низкая уверенность"}` });
    }
  }

  const attempts: TestAttempt[] = seg.attempts.map((a, idx) => {
    const own = instances.filter((q) => q.attemptId === a.id);
    const { meta: _meta, ...rest } = a;
    void _meta;
    return { ...rest, ordinal: idx + 1, questionCount: own.length, endPage: Math.max(a.endPage, ...own.flatMap((q) => q.pages)) };
  });

  const profile = buildProfile(pages, classified, instances, attempts);
  const audit = stage("COVERAGE_AUDIT", () => buildAudit(pages, classified, seg.noiseLineIds, seg.preambleLineIds, instances), (r) => r.status);

  return { documentId: opts.documentId, engineVersion: ENGINE_VERSION, profile, attempts, instances, issues, audit, stageLog };
}
