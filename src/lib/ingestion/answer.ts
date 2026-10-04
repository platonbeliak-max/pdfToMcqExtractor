import type { Evidence, InstanceAnswer, QuestionInstance, VisualMark } from "./types";
import { normalizeForMatch, uuid } from "./text";

/**
 * Learns what private-use icon glyphs mean in *this* document by correlating
 * them with question scores: a glyph that only ever appears in full-score
 * questions is a check, one that only appears in zero-score questions is a
 * cross. Ambiguous glyphs stay UNKNOWN_GLYPH and force manual review.
 */
export function learnGlyphMeanings(instances: QuestionInstance[]): Map<string, "CHECKMARK" | "CROSS"> {
  const stats = new Map<string, { full: number; zero: number }>();
  for (const q of instances) {
    const kind = q.score?.kind;
    if (kind !== "FULL_SCORE" && kind !== "ZERO_SCORE") continue;
    const seen = new Set<string>();
    for (const m of q.visualMarks) {
      if (m.type !== "UNKNOWN_GLYPH" || seen.has(m.rawGlyph)) continue;
      seen.add(m.rawGlyph);
      const s = stats.get(m.rawGlyph) ?? { full: 0, zero: 0 };
      if (kind === "FULL_SCORE") s.full++;
      else s.zero++;
      stats.set(m.rawGlyph, s);
    }
  }
  const out = new Map<string, "CHECKMARK" | "CROSS">();
  for (const [g, s] of stats) {
    const total = s.full + s.zero;
    if (total < 2) continue;
    const ratio = s.full / total;
    if (ratio >= 0.85) out.set(g, "CHECKMARK");
    else if (ratio <= 0.15) out.set(g, "CROSS");
  }
  return out;
}

export function applyGlyphMeanings(q: QuestionInstance, meanings: Map<string, "CHECKMARK" | "CROSS">): QuestionInstance {
  if (meanings.size === 0) return q;
  const marks: VisualMark[] = q.visualMarks.map((m) =>
    m.type === "UNKNOWN_GLYPH" && meanings.has(m.rawGlyph)
      ? { ...m, type: meanings.get(m.rawGlyph)!, confidence: Math.max(m.confidence, 0.85) }
      : m,
  );
  return { ...q, visualMarks: marks };
}

/** Matches "Правильный ответ: ..." feedback against option texts. */
function matchFeedback(q: QuestionInstance): { ids: string[]; textAnswer: string | null; matching: Record<string, string> | null; order: string[] | null } | null {
  if (!q.feedback) return null;
  const m = q.feedback.match(/(?:правильн[а-яёa-z]+\s+ответ[а-яёa-z]*|верн[а-яёa-z]+\s+ответ[а-яёa-z]*|the\s+correct\s+answers?\s+(?:is|are)|correct\s+answers?)\s*[:.]?\s*(.+)$/i);
  if (!m) return null;
  const value = m[1].replace(/\s*(?:ваш\s+ответ|your\s+answer).*$/i, "").trim();
  const normValue = normalizeForMatch(value);

  if (q.questionType === "MATCHING" || /→|->/.test(value)) {
    const pairs: Record<string, string> = {};
    for (const part of value.split(/[,;]\s*(?=[^,;]*(?:→|->))/)) {
      const pm = part.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
      if (!pm) continue;
      const left = normalizeForMatch(pm[1]);
      const opt = q.options.find((o) => o.normalizedText === left || left.includes(o.normalizedText));
      if (opt) pairs[opt.id] = pm[2].trim();
    }
    if (Object.keys(pairs).length) return { ids: [], textAnswer: value, matching: pairs, order: null };
  }

  if (q.options.length === 0) return { ids: [], textAnswer: value, matching: null, order: null };

  // Longest options first so "белки плазмы" doesn't steal "белки".
  const sorted = [...q.options].filter((o) => o.normalizedText.length > 0).sort((a, b) => b.normalizedText.length - a.normalizedText.length);
  let remaining = ` ${normValue} `;
  const found: { id: string; pos: number }[] = [];
  for (const o of sorted) {
    const needle = ` ${o.normalizedText} `;
    const pos = remaining.indexOf(needle);
    if (pos >= 0) {
      found.push({ id: o.id, pos: ` ${normValue} `.indexOf(needle) });
      remaining = remaining.slice(0, pos) + " ".repeat(needle.length) + remaining.slice(pos + needle.length);
    }
  }
  if (found.length === 0) return { ids: [], textAnswer: value, matching: null, order: null };
  const ids = found.sort((a, b) => a.pos - b.pos).map((f) => f.id);
  return { ids, textAnswer: null, matching: null, order: q.questionType === "ORDERING" ? ids : null };
}

/**
 * Determines what the document itself says about the correct answer,
 * strictly from evidence. Never guesses; incomplete knowledge is reported
 * as NEEDS_REVIEW / UNRESOLVED and may be completed later by aggregation.
 */
export function determineAnswer(q: QuestionInstance): QuestionInstance {
  const evidence: Evidence[] = [];
  const reasons: string[] = [];
  const issues = [...q.issues];
  const ev = (e: Omit<Evidence, "id">) => evidence.push({ id: uuid(), ...e });

  const optIds = new Set(q.options.map((o) => o.id));
  const correct = new Set<string>();
  const incorrect = new Set<string>();
  const selected = new Set<string>();
  let complete = false;
  let status: InstanceAnswer["status"] = "UNRESOLVED";
  let confidence = 0;
  let correctOrder: string[] | null = null;
  let matching: Record<string, string> | null = null;
  let textAnswer: string | null = null;

  // Score evidence (question-level).
  if (q.score) {
    const t = q.score.kind === "FULL_SCORE" ? "FULL_SCORE" : q.score.kind === "ZERO_SCORE" ? "ZERO_SCORE" : q.score.kind === "PARTIAL_SCORE" ? "PARTIAL_SCORE" : null;
    if (t) ev({ type: t, source: "SCORE", optionId: null, polarity: null, confidence: 0.95, page: q.score.page, bbox: q.score.bbox, rawValue: q.score.raw });
  }

  // 1. Explicit textual +/- marks
  const plus = q.visualMarks.filter((m) => m.type === "PLUS" && m.associatedOptionId);
  const minus = q.visualMarks.filter((m) => m.type === "MINUS" && m.associatedOptionId);
  if (plus.length || minus.length) {
    for (const m of plus) {
      correct.add(m.associatedOptionId!);
      ev({ type: "EXPLICIT_TEXT_MARK", source: "DOCUMENT", optionId: m.associatedOptionId, polarity: true, confidence: 0.97, page: m.page, bbox: m.bbox, rawValue: m.rawGlyph });
    }
    for (const m of minus) {
      incorrect.add(m.associatedOptionId!);
      ev({ type: "EXPLICIT_TEXT_MARK", source: "DOCUMENT", optionId: m.associatedOptionId, polarity: false, confidence: 0.97, page: m.page, bbox: m.bbox, rawValue: m.rawGlyph });
    }
    const allMarked = q.options.every((o) => correct.has(o.id) || incorrect.has(o.id));
    complete = allMarked && correct.size > 0;
    status = complete ? "CONFIRMED_BY_DOCUMENT" : "NEEDS_REVIEW";
    confidence = complete ? 0.97 : 0.6;
    reasons.push(complete ? "Все варианты размечены +/-" : "Разметка +/- неполная");
    if (correct.size === 0) issues.push("PLUS_MINUS_WITHOUT_PLUS");
  }

  // 2. Feedback text ("Правильный ответ: ...")
  const fb = matchFeedback(q);
  if (fb) {
    ev({ type: "FEEDBACK_TEXT", source: "DOCUMENT", optionId: null, polarity: null, confidence: 0.95, page: q.physicalPage, bbox: null, rawValue: q.feedback ?? "" });
    if (fb.ids.length) {
      const prev = new Set(correct);
      correct.clear();
      fb.ids.forEach((id) => correct.add(id));
      for (const o of q.options) if (!correct.has(o.id)) incorrect.add(o.id);
      for (const id of fb.ids) ev({ type: "FEEDBACK_TEXT", source: "DOCUMENT", optionId: id, polarity: true, confidence: 0.95, page: q.physicalPage, bbox: null, rawValue: q.feedback ?? "" });
      if (prev.size && [...prev].some((id) => !correct.has(id))) {
        issues.push("FEEDBACK_CONTRADICTS_MARKS");
        status = "CONFLICT";
        confidence = 0.4;
      } else {
        complete = true;
        status = "CONFIRMED_BY_DOCUMENT";
        confidence = 0.97;
      }
      if (fb.order) correctOrder = fb.order;
      reasons.push("Текст «Правильный ответ» в документе");
    } else if (fb.matching) {
      matching = fb.matching;
      complete = Object.keys(fb.matching).length === q.options.length;
      status = complete ? "CONFIRMED_BY_DOCUMENT" : "NEEDS_REVIEW";
      confidence = complete ? 0.95 : 0.6;
      reasons.push("Соответствия из текста «Правильный ответ»");
    } else if (fb.textAnswer) {
      textAnswer = fb.textAnswer;
      if (q.options.length === 0) {
        complete = true;
        status = "CONFIRMED_BY_DOCUMENT";
        confidence = 0.93;
        reasons.push("Текстовый правильный ответ из документа");
      } else {
        issues.push("FEEDBACK_UNMATCHED");
        reasons.push("Правильный ответ указан, но не совпал ни с одним вариантом");
      }
    }
  }

  const inline = q.options.length === 0 ? q.inlineCorrectAnswer?.trim() : null;
  if (inline && !textAnswer && status === "UNRESOLVED") {
    ev({ type: "STUDENT_RESPONSE", source: "DOCUMENT", optionId: null, polarity: null, confidence: 0.88, page: q.physicalPage, bbox: null, rawValue: inline });
    textAnswer = inline;
    complete = true;
    status = "CONFIRMED_BY_DOCUMENT";
    confidence = 0.88;
    reasons.push("Правильный ответ указан после вопроса");
  }

  // 2b. Typed response in an answer field, graded by the score.
  const response = q.options.length === 0 ? q.studentResponse?.trim() : null;
  if (response && !textAnswer && status === "UNRESOLVED") {
    ev({ type: "STUDENT_RESPONSE", source: "DOCUMENT", optionId: null, polarity: null, confidence: 0.9, page: q.physicalPage, bbox: null, rawValue: response });
    const kind = q.score?.kind;
    if (kind === "FULL_SCORE") {
      textAnswer = response;
      complete = true;
      status = "CONFIRMED_BY_SCORE";
      confidence = 0.92;
      reasons.push("Полный балл за введённый ответ");
    } else if (kind === "PARTIAL_SCORE") {
      textAnswer = response;
      status = "NEEDS_REVIEW";
      confidence = 0.5;
      reasons.push("Частичный балл за введённый ответ");
    } else if (kind === "ZERO_SCORE") {
      reasons.push(`Введённый ответ «${response}» неверный`);
    } else {
      reasons.push("Введённый ответ без балла");
    }
  }

  // 3. Check / cross / selected marks
  const checks = q.visualMarks.filter((m) => (m.type === "CHECKMARK" || m.type === "HANDWRITTEN_CHECK" || m.type === "CIRCLED") && m.associatedOptionId && optIds.has(m.associatedOptionId));
  const crosses = q.visualMarks.filter((m) => (m.type === "CROSS" || m.type === "HANDWRITTEN_CROSS") && m.associatedOptionId && optIds.has(m.associatedOptionId));
  const sel = q.visualMarks.filter((m) => m.type === "SELECTED" && m.associatedOptionId);
  const unknown = q.visualMarks.filter((m) => m.type === "UNKNOWN_GLYPH");
  if (unknown.length) issues.push("UNKNOWN_MARK_GLYPH");
  if (q.visualMarks.some((m) => !m.associatedOptionId)) issues.push("UNASSOCIATED_MARK");

  for (const m of [...checks, ...crosses, ...sel]) selected.add(m.associatedOptionId!);

  if (status !== "CONFIRMED_BY_DOCUMENT" && status !== "CONFLICT" && (checks.length || crosses.length || sel.length)) {
    for (const m of checks) {
      correct.add(m.associatedOptionId!);
      ev({ type: m.type === "HANDWRITTEN_CHECK" ? "VISION" : "EXPLICIT_CHECKMARK", source: m.source === "VISION" ? "VISION" : "DOCUMENT", optionId: m.associatedOptionId, polarity: true, confidence: m.confidence, page: m.page, bbox: m.bbox, rawValue: m.rawGlyph });
    }
    for (const m of crosses) {
      incorrect.add(m.associatedOptionId!);
      ev({ type: m.type === "HANDWRITTEN_CROSS" ? "VISION" : "EXPLICIT_CROSS", source: m.source === "VISION" ? "VISION" : "DOCUMENT", optionId: m.associatedOptionId, polarity: false, confidence: m.confidence, page: m.page, bbox: m.bbox, rawValue: m.rawGlyph });
    }

    const kind = q.score?.kind ?? "UNKNOWN";
    const single = q.questionType === "SINGLE_CHOICE" || q.questionType === "TRUE_FALSE" || q.questionType === "IMAGE_IDENTIFICATION";
    const markConf = Math.min(...[...checks, ...crosses, ...sel].map((m) => m.confidence), 1);

    if (kind === "FULL_SCORE") {
      if (crosses.length) {
        issues.push("FULL_SCORE_WITH_CROSS");
        status = "CONFLICT";
        confidence = 0.4;
      } else {
        for (const id of selected) correct.add(id);
        for (const o of q.options) if (!correct.has(o.id)) incorrect.add(o.id);
        complete = correct.size > 0;
        status = complete ? "CONFIRMED_BY_SCORE" : "NEEDS_REVIEW";
        confidence = complete ? Math.min(0.97, 0.9 + 0.07 * markConf) : 0.5;
        reasons.push("Полный балл: отмеченные варианты — полный правильный набор");
      }
    } else if (kind === "PARTIAL_SCORE") {
      complete = false;
      status = "NEEDS_REVIEW";
      confidence = 0.55;
      reasons.push("Частичный балл: отмеченные ✓ правильные, но набор может быть неполным");
    } else if (kind === "ZERO_SCORE") {
      for (const id of sel.map((m) => m.associatedOptionId!)) incorrect.add(id);
      if (single && checks.length === 1 && crosses.length >= 1) {
        // LMS shows both the wrong choice (✕) and the right one (✓).
        complete = true;
        status = "CONFIRMED_BY_DOCUMENT";
        confidence = 0.9 * markConf;
        reasons.push("Ноль баллов, но правильный вариант отмечен ✓");
      } else {
        status = correct.size ? "NEEDS_REVIEW" : "UNRESOLVED";
        confidence = correct.size ? 0.5 : 0.2;
        reasons.push("Ноль баллов: известен только неверный выбор");
      }
    } else {
      // No score: an answer key style document (✓ marks the correct answers).
      if (checks.length && !crosses.length) {
        complete = single ? checks.length === 1 : true;
        status = complete ? "CONFIRMED_BY_DOCUMENT" : "NEEDS_REVIEW";
        confidence = complete ? (single ? 0.9 : 0.8) * markConf : 0.5;
        reasons.push(single ? "Правильный вариант отмечен ✓" : "Отмечены ✓ без балла — полнота не подтверждена баллом");
      } else if (crosses.length) {
        status = correct.size ? "NEEDS_REVIEW" : "UNRESOLVED";
        confidence = 0.4;
        reasons.push("Есть только отметки ✕ без балла");
      } else if (sel.length) {
        status = "UNRESOLVED";
        confidence = 0.2;
        reasons.push("Выбор студента без балла не говорит о правильности");
      }
    }
    if (single && correct.size > 1 && status !== "CONFLICT") {
      issues.push("SINGLE_CHOICE_MULTIPLE_CORRECT");
      status = "NEEDS_REVIEW";
      confidence = Math.min(confidence, 0.5);
    }
  } else if (status === "UNRESOLVED" && q.score && !response) {
    reasons.push(q.score.kind === "UNANSWERED" ? "Нет ответа" : "Балл есть, но отметок вариантов не найдено");
  }

  // 4. Ordering via [NN] codes printed next to items
  if (q.questionType === "ORDERING" && !correctOrder) {
    const coded = q.options.filter((o) => typeof o.orderIndex === "number");
    const nums = coded.map((o) => o.orderIndex!).sort((a, b) => a - b);
    const isPerm = coded.length === q.options.length && coded.length >= 2 && nums.every((n, i) => n === nums[0] + i);
    if (isPerm) {
      correctOrder = [...coded].sort((a, b) => a.orderIndex! - b.orderIndex!).map((o) => o.id);
      complete = true;
      status = "CONFIRMED_BY_DOCUMENT";
      confidence = 0.8;
      reasons.push("Порядок указан кодами [NN] возле элементов");
      ev({ type: "EXPLICIT_TEXT_MARK", source: "DOCUMENT", optionId: null, polarity: null, confidence: 0.8, page: q.physicalPage, bbox: null, rawValue: coded.map((o) => `[${o.orderIndex}]`).join(" ") });
    } else if (coded.length) {
      issues.push("ORDER_CODES_INCOMPLETE");
    }
  }

  if (q.questionType === "MATCHING" && !matching) {
    const pairs = q.options.filter((o) => o.pairText);
    if (pairs.length === q.options.length && pairs.length >= 2) {
      matching = Object.fromEntries(pairs.map((o) => [o.id, o.pairText!]));
      status = q.score?.kind === "FULL_SCORE" ? "CONFIRMED_BY_SCORE" : "NEEDS_REVIEW";
      complete = status === "CONFIRMED_BY_SCORE";
      confidence = complete ? 0.9 : 0.5;
      reasons.push(complete ? "Пары соответствий при полном балле" : "Пары соответствий без подтверждения баллом");
    }
  }

  const answer: InstanceAnswer = {
    correctOptionIds: [...correct],
    incorrectOptionIds: [...incorrect].filter((id) => !correct.has(id)),
    selectedOptionIds: [...selected],
    correctOrder,
    matching,
    textAnswer,
    complete,
    status,
    confidence: Number(confidence.toFixed(2)),
    reasons,
  };

  const blocking = ["EMPTY_STEM", "NO_OPTIONS", "SINGLE_OPTION", "UNKNOWN_MARK_GLYPH", "UNASSOCIATED_MARK", "FEEDBACK_UNMATCHED", "FULL_SCORE_WITH_CROSS", "FEEDBACK_CONTRADICTS_MARKS", "SINGLE_CHOICE_MULTIPLE_CORRECT", "BOUNDARY_UNCERTAIN", "LOW_OCR_CONFIDENCE", "FORMULA_FROM_OCR", "IMAGE_REFERENCED_BUT_NOT_FOUND", "DUPLICATE_OPTIONS", "EMPTY_OPTION", "MARK_NOT_ASSOCIATED", "FORMULA_EXPONENT_MAY_BE_FLATTENED", "FORMULA_EXPONENT_DIGITS_MERGED", "FORMULA_REPLACEMENT_CHAR", "ORDER_CODES_INCOMPLETE"];
  const hasBlocking = issues.some((i) => blocking.includes(i));
  const extractionStatus: QuestionInstance["extractionStatus"] =
    !q.stem && q.options.length === 0 ? "FAILED" : hasBlocking || q.confidence < 0.6 || q.questionType === "UNKNOWN" ? "NEEDS_REVIEW" : "PARSED";

  return {
    ...q,
    evidence,
    answer,
    issues: [...new Set(issues)],
    extractionStatus,
    confidence: Number(Math.min(q.confidence, 0.5 + 0.5 * Math.max(answer.confidence, status === "UNRESOLVED" ? 0.6 : 0)).toFixed(2)),
  };
}
