import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attempts,
  canonicalQuestions,
  documentPages,
  documents,
  processingErrors,
  questionInstances,
  reviewTasks,
  type DocumentSummary,
} from "@/lib/db/schema";
import { analyzeDocument, ENGINE_VERSION } from "./pipeline";
import { aggregate, type CanonicalSeed } from "./canonical";
import { uuid } from "./text";
import type { CanonicalOption, CanonicalQuestionDraft, PageInput, QuestionInstance } from "./types";

const CHUNK = 200;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function countBy<T>(arr: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

/* ------------------------------ documents ------------------------------ */

export async function createDocument(input: { filename: string; fileSize: number | null; pageCount: number; subjectSlug: string | null }) {
  const id = uuid();
  await db.insert(documents).values({
    id,
    filename: input.filename.slice(0, 300),
    fileSize: input.fileSize,
    pageCount: input.pageCount,
    subjectSlug: input.subjectSlug,
    subjectSource: input.subjectSlug ? "USER" : null,
    status: "UPLOADING",
    stage: "TEXT_EXTRACTION",
  });
  return id;
}

export async function getDocumentRow(id: string) {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row ?? null;
}

export async function listDocuments() {
  return db
    .select({
      id: documents.id,
      filename: documents.filename,
      pageCount: documents.pageCount,
      pagesReceived: documents.pagesReceived,
      status: documents.status,
      stage: documents.stage,
      subjectSlug: documents.subjectSlug,
      summary: documents.summary,
      createdAt: documents.createdAt,
      importedAt: documents.importedAt,
    })
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .limit(200);
}

export async function attachBlob(id: string, blob: { url: string; pathname: string }) {
  await db.update(documents).set({ blobUrl: blob.url, blobPathname: blob.pathname, updatedAt: new Date() }).where(eq(documents.id, id));
}

/** Idempotent: re-sending a page overwrites it, so batches can be retried safely. */
export async function savePages(id: string, pages: PageInput[]) {
  if (!pages.length) return;
  await db
    .insert(documentPages)
    .values(
      pages.map((p) => ({
        documentId: id,
        pageNumber: p.pageNumber,
        source: p.source,
        textLayerChars: p.textLayerChars,
        ocrConfidence: p.ocrConfidence ?? null,
        input: p,
        rawText: p.items.map((i) => i.str).join(" ").slice(0, 20000),
        readErrors: p.readErrors ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [documentPages.documentId, documentPages.pageNumber],
      set: {
        source: sql`excluded.source`,
        textLayerChars: sql`excluded.text_layer_chars`,
        ocrConfidence: sql`excluded.ocr_confidence`,
        input: sql`excluded.input`,
        rawText: sql`excluded.raw_text`,
        readErrors: sql`excluded.read_errors`,
      },
    });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(documentPages).where(eq(documentPages.documentId, id));
  await db.update(documents).set({ pagesReceived: n, updatedAt: new Date() }).where(eq(documents.id, id));
  return n;
}

export async function setStage(id: string, stage: string, status?: string, error?: string | null) {
  await db
    .update(documents)
    .set({ stage, ...(status ? { status } : {}), ...(error !== undefined ? { error } : {}), updatedAt: new Date() })
    .where(eq(documents.id, id));
}

/**
 * Runs the deterministic engine on stored raw pages and replaces this
 * document's attempts/instances/errors. Safe to repeat (e.g. after an engine
 * upgrade); an already-imported document is detached from the bank first.
 */
export async function runAnalysis(id: string) {
  const doc = await getDocumentRow(id);
  if (!doc) throw new Error("Документ не найден");

  const pageRows = await db.select({ input: documentPages.input }).from(documentPages).where(eq(documentPages.documentId, id)).orderBy(asc(documentPages.pageNumber));
  if (!pageRows.length) throw new Error("Нет сохранённых страниц для анализа");

  await setStage(id, "LAYOUT_ANALYSIS", "PROCESSING", null);

  if (doc.importedAt) await detachDocument(id);

  const analysis = analyzeDocument(
    pageRows.map((r) => r.input),
    { documentId: id, subjectSlug: doc.subjectSlug },
  );

  await db.delete(questionInstances).where(eq(questionInstances.documentId, id));
  await db.delete(attempts).where(eq(attempts.documentId, id));
  await db.delete(processingErrors).where(eq(processingErrors.documentId, id));

  if (analysis.attempts.length) {
    await db.insert(attempts).values(
      analysis.attempts.map((a) => ({
        id: a.id,
        documentId: id,
        ordinal: a.ordinal,
        title: a.title,
        state: a.state,
        scoreEarned: a.scoreEarned,
        scoreMax: a.scoreMax,
        grade: a.grade,
        startPage: a.startPage,
        endPage: a.endPage,
        questionCount: a.questionCount,
        data: a,
      })),
    );
  }
  for (const part of chunks(analysis.instances)) {
    await db.insert(questionInstances).values(
      part.map((q) => ({
        id: q.id,
        documentId: id,
        attemptId: q.attemptId,
        sequence: q.sequence,
        questionNumber: q.questionNumber,
        physicalPage: q.physicalPage,
        questionType: q.questionType,
        extractionStatus: q.extractionStatus,
        answerStatus: q.answer.status,
        confidence: q.confidence,
        stem: q.stem,
        normalizedStem: q.normalizedStem,
        data: q,
      })),
    );
  }
  for (const part of chunks(analysis.issues)) {
    await db.insert(processingErrors).values(
      part.map((e) => ({ documentId: id, page: e.page, stage: e.stage, severity: e.severity, code: e.code, message: e.message.slice(0, 2000) })),
    );
  }

  const inst = analysis.instances;
  const summary: DocumentSummary = {
    attempts: analysis.attempts.length,
    detected: inst.length,
    parsed: analysis.audit.totalParsed,
    needsReview: analysis.audit.totalNeedsReview,
    failed: analysis.audit.totalFailed,
    answerStatus: countBy(inst, (q) => q.answer.status),
    questionTypes: countBy(inst, (q) => q.questionType),
  };

  const autoSubject = analysis.profile.detectedSubject;
  await db
    .update(documents)
    .set({
      status: analysis.audit.status === "COMPLETE" ? "ANALYZED" : "PROCESSING_INCOMPLETE",
      stage: "PREVIEW",
      engineVersion: ENGINE_VERSION,
      profile: analysis.profile,
      audit: analysis.audit,
      summary,
      stageLog: analysis.stageLog,
      importedAt: null,
      subjectSlug: doc.subjectSlug ?? autoSubject?.slug ?? null,
      subjectSource: doc.subjectSlug ? doc.subjectSource : autoSubject ? "AUTO" : null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id));

  return { summary, audit: analysis.audit, profile: analysis.profile };
}

export async function getDocumentDetail(id: string) {
  const doc = await getDocumentRow(id);
  if (!doc) return null;
  const [attemptRows, instanceRows, errorRows] = await Promise.all([
    db.select({ data: attempts.data }).from(attempts).where(eq(attempts.documentId, id)).orderBy(asc(attempts.ordinal)),
    db
      .select({ data: questionInstances.data, canonicalId: questionInstances.canonicalId })
      .from(questionInstances)
      .where(eq(questionInstances.documentId, id))
      .orderBy(asc(questionInstances.sequence)),
    db.select().from(processingErrors).where(eq(processingErrors.documentId, id)).orderBy(asc(processingErrors.id)).limit(500),
  ]);
  const { blobUrl: _blobUrl, ...safeDoc } = doc;
  void _blobUrl;
  return {
    document: safeDoc,
    attempts: attemptRows.map((r) => r.data),
    instances: instanceRows.map((r) => ({ ...r.data, canonicalId: r.canonicalId })),
    errors: errorRows,
  };
}

export async function deleteDocument(id: string) {
  const doc = await getDocumentRow(id);
  if (!doc) return null;
  if (doc.importedAt) await detachDocument(id);
  await db.delete(questionInstances).where(eq(questionInstances.documentId, id));
  await db.delete(attempts).where(eq(attempts.documentId, id));
  await db.delete(processingErrors).where(eq(processingErrors.documentId, id));
  await db.delete(documentPages).where(eq(documentPages.documentId, id));
  await db.delete(reviewTasks).where(eq(reviewTasks.documentId, id));
  await db.delete(documents).where(eq(documents.id, id));
  return doc;
}

/* ------------------------------ canonicals ------------------------------ */

type CanonicalRow = typeof canonicalQuestions.$inferSelect;

function seedFrom(row: CanonicalRow, instanceIds: string[], zeroVotes: boolean): CanonicalSeed {
  return {
    key: row.id,
    stem: row.stem,
    normalizedStem: row.normalizedStem,
    questionType: row.questionType as CanonicalSeed["questionType"],
    hasImage: row.hasImage,
    instanceIds: zeroVotes ? [] : instanceIds,
    options: row.options.map((o) =>
      zeroVotes
        ? { ...o, correctVotes: 0, incorrectVotes: 0, selectedCount: 0, instanceOptionIds: [] }
        : { ...o, instanceOptionIds: [...o.instanceOptionIds] },
    ),
  };
}

function isManual(row: CanonicalRow | undefined) {
  return !!row && (row.reviewStatus === "APPROVED" || row.answerStatus === "MANUALLY_CONFIRMED" || row.answerStatus === "MEDICALLY_VERIFIED");
}

async function writeCanonical(draft: CanonicalQuestionDraft, prev: CanonicalRow | undefined, subjectSlug: string | null, documentIds: string[]) {
  const manual = isManual(prev);
  const values = {
    stem: draft.stem,
    normalizedStem: draft.normalizedStem,
    questionType: manual ? prev!.questionType : draft.questionType,
    options: draft.options,
    correctKeys: manual ? prev!.correctKeys : draft.correctKeys,
    correctOrder: manual ? prev!.correctOrder : draft.correctOrder,
    matching: manual ? prev!.matching : draft.matching,
    textAnswer: manual ? prev!.textAnswer : draft.textAnswer,
    answerStatus: manual ? prev!.answerStatus : draft.answerStatus,
    confidence: manual ? prev!.confidence : draft.confidence,
    conflicts: draft.conflicts,
    reasons: draft.reasons,
    hasImage: draft.hasImage,
    instanceCount: draft.instanceIds.length,
    documentIds,
    updatedAt: new Date(),
  };
  if (prev) {
    await db.update(canonicalQuestions).set(values).where(eq(canonicalQuestions.id, prev.id));
  } else {
    await db.insert(canonicalQuestions).values({
      id: draft.key,
      key: draft.key,
      subjectSlug,
      reviewStatus: "PENDING",
      inBank: draft.answerStatus.startsWith("CONFIRMED") || draft.answerStatus === "MEDICALLY_VERIFIED",
      ...values,
    });
  }
}

async function instanceDocMap(instanceIds: string[]) {
  const map = new Map<string, string>();
  for (const part of chunks(instanceIds, 1000)) {
    const rows = await db.select({ id: questionInstances.id, documentId: questionInstances.documentId }).from(questionInstances).where(inArray(questionInstances.id, part));
    for (const r of rows) map.set(r.id, r.documentId);
  }
  return map;
}

/** Recompute canonicals from their remaining members (used when a document is detached). */
async function recomputeCanonicals(ids: string[], excludeDocumentId: string) {
  if (!ids.length) return;
  const rows = await db.select().from(canonicalQuestions).where(inArray(canonicalQuestions.id, ids));
  for (const row of rows) {
    const members = await db
      .select({ data: questionInstances.data, documentId: questionInstances.documentId })
      .from(questionInstances)
      .where(and(eq(questionInstances.canonicalId, row.id), sql`${questionInstances.documentId} <> ${excludeDocumentId}`));
    if (!members.length) {
      await db.delete(canonicalQuestions).where(eq(canonicalQuestions.id, row.id));
      await db.delete(reviewTasks).where(eq(reviewTasks.canonicalId, row.id));
      continue;
    }
    const res = aggregate(members.map((m) => m.data), [seedFrom(row, [], true)], uuid);
    const draft = res.canonicals.find((c) => c.key === row.id) ?? res.canonicals[0];
    await writeCanonical({ ...draft, key: row.id, instanceIds: members.map((m) => m.data.id) }, row, row.subjectSlug, [...new Set(members.map((m) => m.documentId))]);
  }
}

async function detachDocument(id: string) {
  const rows = await db
    .selectDistinct({ canonicalId: questionInstances.canonicalId })
    .from(questionInstances)
    .where(and(eq(questionInstances.documentId, id), sql`${questionInstances.canonicalId} is not null`));
  await db.update(questionInstances).set({ canonicalId: null }).where(eq(questionInstances.documentId, id));
  await db.delete(reviewTasks).where(eq(reviewTasks.documentId, id));
  await recomputeCanonicals(rows.map((r) => r.canonicalId!).filter(Boolean), id);
  await db.update(documents).set({ importedAt: null }).where(eq(documents.id, id));
}

/**
 * Imports analyzed instances into the bank: groups them with existing
 * canonical questions (cross-attempt, cross-document), aggregates evidence,
 * and opens review tasks for anything not confidently resolved.
 */
export async function importDocument(id: string, opts: { subjectSlug?: string | null } = {}) {
  const doc = await getDocumentRow(id);
  if (!doc) throw new Error("Документ не найден");
  if (doc.importedAt) await detachDocument(id);
  await setStage(id, "DEDUPLICATION", "IMPORTING");

  const subjectSlug = opts.subjectSlug !== undefined ? opts.subjectSlug : doc.subjectSlug;
  if (opts.subjectSlug !== undefined) {
    await db.update(documents).set({ subjectSlug: opts.subjectSlug, subjectSource: "USER" }).where(eq(documents.id, id));
  }

  const instRows = await db.select({ data: questionInstances.data }).from(questionInstances).where(eq(questionInstances.documentId, id)).orderBy(asc(questionInstances.sequence));
  const instances: QuestionInstance[] = instRows.map((r) => r.data);

  // Seeds: canonicals of the same subject (or all when unknown).
  const seedRows = await db
    .select()
    .from(canonicalQuestions)
    .where(subjectSlug ? sql`(${canonicalQuestions.subjectSlug} = ${subjectSlug} or ${canonicalQuestions.subjectSlug} is null)` : sql`true`);
  const memberRows = seedRows.length
    ? await db
        .select({ id: questionInstances.id, canonicalId: questionInstances.canonicalId })
        .from(questionInstances)
        .where(sql`${questionInstances.canonicalId} is not null`)
    : [];
  const membersBy = new Map<string, string[]>();
  for (const m of memberRows) {
    if (!membersBy.has(m.canonicalId!)) membersBy.set(m.canonicalId!, []);
    membersBy.get(m.canonicalId!)!.push(m.id);
  }
  const seedById = new Map(seedRows.map((r) => [r.id, r]));
  const seeds = seedRows.map((r) => seedFrom(r, membersBy.get(r.id) ?? [], false));

  const result = aggregate(instances, seeds, uuid);
  const touched = result.canonicals.filter((c) => c.instanceIds.some((iid) => instances.some((q) => q.id === iid)));
  const docMap = await instanceDocMap(touched.flatMap((c) => c.instanceIds));

  let newCanonicals = 0;
  let merged = 0;
  for (const c of touched) {
    const prev = seedById.get(c.key);
    if (prev) merged++;
    else newCanonicals++;
    const docIds = [...new Set(c.instanceIds.map((iid) => docMap.get(iid) ?? id))];
    await writeCanonical(c, prev, subjectSlug ?? null, docIds);
  }

  for (const [iid, key] of result.assignment) {
    await db.update(questionInstances).set({ canonicalId: key }).where(eq(questionInstances.id, iid));
  }

  const tasks: (typeof reviewTasks.$inferInsert)[] = [];
  for (const c of touched) {
    if (isManual(seedById.get(c.key))) continue;
    if (c.answerStatus === "CONFLICT") tasks.push({ documentId: id, canonicalId: c.key, kind: "ANSWER_CONFLICT", reason: c.conflicts.join("; ") || "Конфликт доказательств" });
    else if (c.answerStatus === "NEEDS_REVIEW") tasks.push({ documentId: id, canonicalId: c.key, kind: "ANSWER_REVIEW", reason: c.reasons.join("; ") || "Недостаточно доказательств" });
    else if (c.answerStatus === "UNRESOLVED") tasks.push({ documentId: id, canonicalId: c.key, kind: "NO_ANSWER", reason: "Правильный ответ не найден в документе" });
  }
  for (const q of instances) {
    if (q.extractionStatus !== "PARSED") {
      tasks.push({ documentId: id, canonicalId: result.assignment.get(q.id) ?? null, instanceId: q.id, kind: q.extractionStatus === "FAILED" ? "EXTRACTION_FAILED" : "EXTRACTION_REVIEW", reason: q.issues.join(", ") || "Низкая уверенность разбора" });
    }
  }
  for (const cand of result.candidates) {
    tasks.push({
      documentId: id,
      canonicalId: result.assignment.get(cand.instanceId) ?? null,
      instanceId: cand.instanceId,
      kind: "POSSIBLE_DUPLICATE",
      reason: `${cand.match.reason} (уровень ${cand.match.level}, сходство ${(cand.match.score * 100).toFixed(0)}%)`,
      resolution: { candidateCanonicalId: cand.canonicalKey },
    });
  }
  for (const part of chunks(tasks)) await db.insert(reviewTasks).values(part);

  const summary: DocumentSummary = {
    ...(doc.summary ?? { attempts: 0, detected: 0, parsed: 0, needsReview: 0, failed: 0, answerStatus: {}, questionTypes: {} }),
    imported: { canonicals: touched.length, newCanonicals, merged, reviewTasks: tasks.length },
  };
  await db
    .update(documents)
    .set({ status: "IMPORTED", stage: "IMPORTED", importedAt: new Date(), summary, updatedAt: new Date() })
    .where(eq(documents.id, id));

  return summary.imported!;
}

/* ------------------------------ bank / review ------------------------------ */

export interface BankFilters {
  q?: string | null;
  subject?: string | null;
  status?: string | null;
  type?: string | null;
  inBank?: boolean | null;
  limit?: number;
  offset?: number;
}

export async function listCanonicals(f: BankFilters) {
  const conds = [sql`true`];
  if (f.subject) conds.push(eq(canonicalQuestions.subjectSlug, f.subject));
  if (f.status) conds.push(eq(canonicalQuestions.answerStatus, f.status));
  if (f.type) conds.push(eq(canonicalQuestions.questionType, f.type));
  if (f.inBank != null) conds.push(eq(canonicalQuestions.inBank, f.inBank));
  if (f.q) conds.push(sql`${canonicalQuestions.stem} ilike ${"%" + f.q.replace(/[%_]/g, "\\$&") + "%"}`);
  const where = and(...conds);
  const [rows, [{ total }], statusCounts] = await Promise.all([
    db
      .select()
      .from(canonicalQuestions)
      .where(where)
      .orderBy(desc(canonicalQuestions.updatedAt))
      .limit(Math.min(f.limit ?? 50, 200))
      .offset(f.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(canonicalQuestions).where(where),
    db
      .select({ status: canonicalQuestions.answerStatus, n: sql<number>`count(*)::int` })
      .from(canonicalQuestions)
      .groupBy(canonicalQuestions.answerStatus),
  ]);
  return { items: rows, total, statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s.n])) };
}

export async function getCanonical(id: string) {
  const [row] = await db.select().from(canonicalQuestions).where(eq(canonicalQuestions.id, id));
  if (!row) return null;
  const members = await db
    .select({ data: questionInstances.data, documentId: questionInstances.documentId, filename: documents.filename })
    .from(questionInstances)
    .leftJoin(documents, eq(documents.id, questionInstances.documentId))
    .where(eq(questionInstances.canonicalId, id))
    .orderBy(asc(questionInstances.createdAt))
    .limit(50);
  const tasks = await db.select().from(reviewTasks).where(and(eq(reviewTasks.canonicalId, id), eq(reviewTasks.status, "OPEN")));
  return { canonical: row, instances: members.map((m) => ({ ...m.data, filename: m.filename })), tasks };
}

export interface ManualAnswer {
  correctKeys?: string[];
  correctOrder?: string[] | null;
  matching?: Record<string, string> | null;
  textAnswer?: string | null;
  stem?: string;
  optionTexts?: Record<string, string>;
  questionType?: string;
  topic?: string | null;
  subjectSlug?: string | null;
  inBank?: boolean;
}

export async function updateCanonicalManual(id: string, patch: ManualAnswer, approve: boolean) {
  const [row] = await db.select().from(canonicalQuestions).where(eq(canonicalQuestions.id, id));
  if (!row) return null;
  const options: CanonicalOption[] = row.options.map((o) => (patch.optionTexts?.[o.key] ? { ...o, text: patch.optionTexts[o.key] } : o));
  const validKeys = new Set(options.map((o) => o.key));
  const correctKeys = patch.correctKeys ? patch.correctKeys.filter((k) => validKeys.has(k)) : row.correctKeys;
  await db
    .update(canonicalQuestions)
    .set({
      stem: patch.stem?.trim() || row.stem,
      options,
      correctKeys,
      correctOrder: patch.correctOrder !== undefined ? patch.correctOrder : row.correctOrder,
      matching: patch.matching !== undefined ? patch.matching : row.matching,
      textAnswer: patch.textAnswer !== undefined ? patch.textAnswer : row.textAnswer,
      questionType: patch.questionType ?? row.questionType,
      topic: patch.topic !== undefined ? patch.topic : row.topic,
      subjectSlug: patch.subjectSlug !== undefined ? patch.subjectSlug : row.subjectSlug,
      ...(approve
        ? { answerStatus: "MANUALLY_CONFIRMED", reviewStatus: "APPROVED", confidence: 1, inBank: patch.inBank ?? true, conflicts: [] }
        : patch.inBank !== undefined
          ? { inBank: patch.inBank }
          : {}),
      updatedAt: new Date(),
    })
    .where(eq(canonicalQuestions.id, id));
  if (approve) {
    await db
      .update(reviewTasks)
      .set({ status: "RESOLVED", resolvedAt: new Date(), resolution: { action: "MANUAL_APPROVE", correctKeys } })
      .where(and(eq(reviewTasks.canonicalId, id), eq(reviewTasks.status, "OPEN"), sql`${reviewTasks.kind} <> 'POSSIBLE_DUPLICATE'`));
  }
  const [updated] = await db.select().from(canonicalQuestions).where(eq(canonicalQuestions.id, id));
  return updated;
}

export async function rejectCanonical(id: string) {
  await db.update(canonicalQuestions).set({ reviewStatus: "REJECTED", inBank: false, updatedAt: new Date() }).where(eq(canonicalQuestions.id, id));
  await db
    .update(reviewTasks)
    .set({ status: "RESOLVED", resolvedAt: new Date(), resolution: { action: "REJECT" } })
    .where(and(eq(reviewTasks.canonicalId, id), eq(reviewTasks.status, "OPEN")));
}

/** Merge `sourceId` into `targetId` (possible-duplicate resolution). */
export async function mergeCanonicals(targetId: string, sourceId: string) {
  if (targetId === sourceId) return;
  const rows = await db.select().from(canonicalQuestions).where(inArray(canonicalQuestions.id, [targetId, sourceId]));
  const target = rows.find((r) => r.id === targetId);
  if (!target || !rows.find((r) => r.id === sourceId)) throw new Error("Вопрос не найден");
  await db.update(questionInstances).set({ canonicalId: targetId }).where(eq(questionInstances.canonicalId, sourceId));
  await db.update(reviewTasks).set({ canonicalId: targetId }).where(eq(reviewTasks.canonicalId, sourceId));
  await db.delete(canonicalQuestions).where(eq(canonicalQuestions.id, sourceId));
  const members = await db.select({ data: questionInstances.data, documentId: questionInstances.documentId }).from(questionInstances).where(eq(questionInstances.canonicalId, targetId));
  const seed = seedFrom(target, [], true);
  // The user decided these are the same question: fold any members the matcher
  // would split off back into the target, union their options, and re-review.
  const res = aggregate(members.map((m) => m.data), [seed], uuid);
  const allOptions = new Map<string, CanonicalOption>();
  let draft = res.canonicals.find((c) => c.key === targetId) ?? res.canonicals[0];
  for (const c of res.canonicals) {
    for (const o of c.options) {
      const prev = allOptions.get(o.normalizedText);
      allOptions.set(
        o.normalizedText,
        prev
          ? { ...prev, correctVotes: prev.correctVotes + o.correctVotes, incorrectVotes: prev.incorrectVotes + o.incorrectVotes, selectedCount: prev.selectedCount + o.selectedCount, instanceOptionIds: [...prev.instanceOptionIds, ...o.instanceOptionIds] }
          : o,
      );
    }
  }
  const split = res.canonicals.length > 1;
  draft = {
    ...draft,
    key: targetId,
    options: [...allOptions.values()],
    instanceIds: members.map((m) => m.data.id),
    answerStatus: split ? "NEEDS_REVIEW" : draft.answerStatus,
    reasons: split ? [...draft.reasons, "Объединено вручную — проверьте ответ"] : draft.reasons,
  };
  await writeCanonical(draft, target, target.subjectSlug, [...new Set(members.map((m) => m.documentId))]);
}

export async function listReviewTasks(filters: { status?: string; kind?: string | null; documentId?: string | null; limit?: number }) {
  const conds = [eq(reviewTasks.status, filters.status ?? "OPEN")];
  if (filters.kind) conds.push(eq(reviewTasks.kind, filters.kind));
  if (filters.documentId) conds.push(eq(reviewTasks.documentId, filters.documentId));
  const rows = await db
    .select({
      task: reviewTasks,
      stem: canonicalQuestions.stem,
      answerStatus: canonicalQuestions.answerStatus,
      filename: documents.filename,
    })
    .from(reviewTasks)
    .leftJoin(canonicalQuestions, eq(canonicalQuestions.id, reviewTasks.canonicalId))
    .leftJoin(documents, eq(documents.id, reviewTasks.documentId))
    .where(and(...conds))
    .orderBy(asc(reviewTasks.id))
    .limit(Math.min(filters.limit ?? 100, 300));
  const counts = await db
    .select({ kind: reviewTasks.kind, n: sql<number>`count(*)::int` })
    .from(reviewTasks)
    .where(eq(reviewTasks.status, "OPEN"))
    .groupBy(reviewTasks.kind);
  return { items: rows, counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])) };
}

export async function resolveTask(taskId: number, resolution: Record<string, unknown>, status: "RESOLVED" | "DISMISSED" = "RESOLVED") {
  await db.update(reviewTasks).set({ status, resolvedAt: new Date(), resolution }).where(eq(reviewTasks.id, taskId));
}

export async function getTask(taskId: number) {
  const [row] = await db.select().from(reviewTasks).where(eq(reviewTasks.id, taskId));
  return row ?? null;
}
