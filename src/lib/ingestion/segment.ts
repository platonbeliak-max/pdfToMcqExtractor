import type { ClassifiedLine, ProcessingIssue, TestAttempt } from "./types";
import type { OptionMeta } from "./classify";
import { parseLocaleNumber, uuid } from "./text";

export interface RawBlock {
  id: string;
  attemptIndex: number;
  headerNumber: number | null;
  headerless: boolean;
  lines: ClassifiedLine[];
  /** Why the segmenter opened this block (traceability). */
  openedBy: string;
}

export interface SegmentResult {
  attempts: (Omit<TestAttempt, "questionCount"> & { meta: Record<string, string> })[];
  blocks: RawBlock[];
  /** Lines that were consumed as attempt metadata / preamble (not questions). */
  preambleLineIds: string[];
  noiseLineIds: string[];
  issues: ProcessingIssue[];
}

const ATTEMPT_START_KEYS = /^(тест\s+начат|started\s+on|начат|попытка|attempt)$/i;

function verticalGap(a: ClassifiedLine, b: ClassifiedLine): number {
  if (a.page !== b.page) return Number.POSITIVE_INFINITY;
  return b.bbox.y - (a.bbox.y + a.bbox.h);
}

/**
 * Splits the classified line stream into attempts and question blocks.
 * Rules are evidence-driven and never discard lines: every non-noise line
 * ends up in a block, attempt metadata, or preamble — preamble that looks
 * like question content is promoted to a headerless block.
 */
export function segment(lines: ClassifiedLine[], documentId: string): SegmentResult {
  const strongHeaders = lines.filter(
    (l) => l.role === "QUESTION_HEADER" && (l.meta?.strength === "strong" || l.meta?.strength === "medium"),
  ).length;
  /** When a document uses explicit "Вопрос N" headers, numbered lines are options. */
  const explicitHeaderMode = strongHeaders >= 2;

  const attempts: SegmentResult["attempts"] = [];
  const blocks: RawBlock[] = [];
  const preambleLineIds: string[] = [];
  const noiseLineIds: string[] = [];
  const issues: ProcessingIssue[] = [];

  let pending: ClassifiedLine[] = [];
  let current: RawBlock | null = null;
  let lastNumber = 0;
  let attemptHasQuestions = false;

  const newAttempt = (startPage: number, reason: string) => {
    attempts.push({
      id: uuid(),
      documentId,
      ordinal: attempts.length + 1,
      title: null,
      startedAt: null,
      finishedAt: null,
      state: null,
      scoreEarned: null,
      scoreMax: null,
      grade: null,
      startPage,
      endPage: startPage,
      boundaryReason: reason,
      meta: {},
    });
    attemptHasQuestions = false;
    lastNumber = 0;
  };

  const currentAttempt = () => attempts[attempts.length - 1];

  const flushPending = () => {
    if (pending.length === 0) return;
    const optionLike = pending.filter((l) => l.role === "OPTION" || l.role === "INSTRUCTION").length;
    const questionLike = pending.some((l) => /[?？]\s*$/.test(l.text) || l.role === "SCORE" || l.role === "STATUS");
    if (optionLike >= 2 || questionLike) {
      blocks.push({
        id: uuid(),
        attemptIndex: attempts.length - 1,
        headerNumber: null,
        headerless: true,
        lines: pending,
        openedBy: "preamble-promoted",
      });
      attemptHasQuestions = true;
    } else {
      const att = currentAttempt();
      for (const l of pending) {
        preambleLineIds.push(l.id);
        if (!att.title && l.role === "TEXT" && l.text.length >= 4 && l.text.length <= 160) att.title = l.text;
      }
    }
    pending = [];
  };

  const closeBlock = () => {
    if (current) blocks.push(current);
    current = null;
  };

  const openBlock = (line: ClassifiedLine, number: number | null, headerless: boolean, openedBy: string) => {
    flushPending();
    closeBlock();
    if (number !== null) {
      if (attemptHasQuestions && number === 1 && lastNumber >= 1) {
        newAttempt(line.page, "numbering-reset");
      } else if (attemptHasQuestions && number <= lastNumber) {
        issues.push({
          stage: "ATTEMPT_DETECTION",
          page: line.page,
          severity: "WARNING",
          code: "NUMBER_NOT_INCREASING",
          message: `Номер вопроса ${number} после ${lastNumber} без явной границы попытки`,
          lineIds: [line.id],
        });
      } else if (lastNumber > 0 && number > lastNumber + 1) {
        issues.push({
          stage: "QUESTION_DETECTION",
          page: line.page,
          severity: "WARNING",
          code: "NUMBER_GAP",
          message: `Пропуск нумерации: после ${lastNumber} идёт ${number}. Возможно, часть вопросов не распознана на странице.`,
          lineIds: [line.id],
        });
      }
      lastNumber = number;
    }
    current = {
      id: uuid(),
      attemptIndex: attempts.length - 1,
      headerNumber: number,
      headerless,
      lines: [line],
      openedBy,
    };
    attemptHasQuestions = true;
  };

  newAttempt(lines[0]?.page ?? 1, "document-start");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const att = currentAttempt();
    att.endPage = Math.max(att.endPage, line.page);

    if (line.role === "NOISE") {
      noiseLineIds.push(line.id);
      continue;
    }

    if (line.role === "ATTEMPT_META") {
      const key = String(line.meta?.key ?? "");
      const isStart = ATTEMPT_START_KEYS.test(key);
      if (isStart && (attemptHasQuestions || current)) {
        flushPending();
        closeBlock();
        newAttempt(line.page, `attempt-header:${key}`);
      } else if (current && attemptHasQuestions && Object.prototype.hasOwnProperty.call(att.meta, key)) {
        // Same metadata key twice → a new attempt summary started without "Тест начат".
        flushPending();
        closeBlock();
        newAttempt(line.page, `repeated-meta:${key}`);
      } else if (current) {
        // Summary rows after questions belong to the attempt, close the block.
        closeBlock();
      }
      const a = currentAttempt();
      a.meta[key] = String(line.meta?.value ?? "");
      preambleLineIds.push(line.id);
      continue;
    }

    if (line.role === "QUESTION_HEADER") {
      const n = typeof line.meta?.number === "number" ? (line.meta.number as number) : null;
      openBlock(line, n, false, "header");
      continue;
    }

    if (line.role === "OPTION") {
      const opt = line.meta as unknown as OptionMeta;
      if (opt.kind === "NUMBER" && !explicitHeaderMode) {
        const n = opt.number ?? 0;
        const expectedQ = lastNumber + 1;
        const blockOptions = current ? current.lines.filter((l) => l.role === "OPTION") : [];
        const lastNumOpt = [...blockOptions].reverse().find((l) => (l.meta as unknown as OptionMeta).kind === "NUMBER");
        const expectedOpt = lastNumOpt ? ((lastNumOpt.meta as unknown as OptionMeta).number ?? 0) + 1 : 1;
        const letterOptions = blockOptions.some((l) => (l.meta as unknown as OptionMeta).kind === "LETTER");
        const stemEndsLikePrompt = current
          ? /[:?？]\s*$/.test(current.lines[current.lines.length - 1].text) || current.lines.some((l) => l.role === "INSTRUCTION")
          : false;

        let isHeader: boolean;
        if (!current) isHeader = true;
        else if (letterOptions) isHeader = n === expectedQ || n > lastNumber;
        else if (n === expectedOpt && n !== expectedQ) isHeader = false;
        else if (n === expectedQ && n !== expectedOpt) isHeader = blockOptions.length >= 2 || !stemEndsLikePrompt;
        else if (n === expectedQ && n === expectedOpt) isHeader = blockOptions.length >= 2 ? true : !stemEndsLikePrompt;
        else isHeader = n > lastNumber && blockOptions.length >= 2;

        if (isHeader) {
          const promoted: ClassifiedLine = {
            ...line,
            role: "QUESTION_HEADER",
            meta: { number: n, inline: opt.text, strength: "weak" },
          };
          openBlock(promoted, n, false, "numbered-line");
          continue;
        }
      }
    }

    if (!current) {
      // Content before any header: keep as pending; decided on next header / flush.
      // PLUS_MINUS banks without headers: a stem line followed by option lines.
      pending.push(line);
      const pmCount = pending.filter((l) => l.role === "OPTION").length;
      if (pmCount >= 1 && line.role === "OPTION") {
        const stemLines = pending.filter((l) => l.role !== "OPTION");
        if (stemLines.length > 0) {
          current = {
            id: uuid(),
            attemptIndex: attempts.length - 1,
            headerNumber: null,
            headerless: true,
            lines: pending,
            openedBy: "stem-before-options",
          };
          pending = [];
          attemptHasQuestions = true;
        }
      }
      continue;
    }

    // Headerless banks: a TEXT line after options may start the next question.
    if (current && line.role === "TEXT") {
      const blockOptions = current.lines.filter((l) => l.role === "OPTION");
      const prev = current.lines[current.lines.length - 1];
      if (blockOptions.length >= 2 && prev.role === "OPTION") {
        const nextLine = lines[i + 1];
        const followedByOption = nextLine && nextLine.role === "OPTION";
        const gap = verticalGap(prev, line);
        const lineH = Math.max(prev.bbox.h, 1);
        const prevOpt = prev.meta as unknown as OptionMeta;
        const outdented = line.bbox.x < prev.bbox.x - lineH * 0.3;
        const isPm = prevOpt?.kind === "PLUS_MINUS";
        if ((current.headerless || !explicitHeaderMode) && (isPm || followedByOption) && (gap > lineH * 0.9 || /[:?？]\s*$/.test(line.text) || outdented || followedByOption)) {
          closeBlock();
          current = {
            id: uuid(),
            attemptIndex: attempts.length - 1,
            headerNumber: null,
            headerless: true,
            lines: [line],
            openedBy: "text-after-options",
          };
          attemptHasQuestions = true;
          continue;
        }
      }
    }

    current.lines.push(line);
  }

  flushPending();
  closeBlock();

  // Finalize attempt metadata (dates, state, scores).
  for (const a of attempts) {
    for (const [k, v] of Object.entries(a.meta)) {
      if (/^(тест\s+начат|начат|started\s+on)$/i.test(k)) a.startedAt = v || null;
      else if (/^(завершен|завершено|completed\s+on)$/i.test(k)) a.finishedAt = v || null;
      else if (/^(состояние|state)$/i.test(k)) a.state = v || null;
      else if (/^(баллы|marks)$/i.test(k)) {
        const m = v.match(/([\d.,]+)\s*(?:\/|из|out\s+of)\s*([\d.,]+)/i);
        if (m) {
          a.scoreEarned = parseLocaleNumber(m[1]);
          a.scoreMax = parseLocaleNumber(m[2]);
        }
      } else if (/^(оценка|grade)$/i.test(k)) a.grade = v || null;
    }
  }

  // Drop attempts that ended up with nothing but keep their metadata lines accounted.
  const used = new Set(blocks.map((b) => b.attemptIndex));
  const kept = attempts.filter((a, idx) => used.has(idx) || Object.keys(a.meta).length > 0);
  const remap = new Map<number, number>();
  attempts.forEach((a, idx) => {
    const ni = kept.indexOf(a);
    if (ni >= 0) remap.set(idx, ni);
  });
  for (const b of blocks) {
    b.attemptIndex = remap.get(b.attemptIndex) ?? Math.max(0, kept.length - 1);
  }
  if (kept.length === 0) kept.push(attempts[0]);
  kept.forEach((a, i) => (a.ordinal = i + 1));

  return { attempts: kept, blocks, preambleLineIds, noiseLineIds, issues };
}
