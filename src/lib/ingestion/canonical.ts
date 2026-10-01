import type {
  AnswerStatus,
  CanonicalOption,
  CanonicalQuestionDraft,
  QuestionInstance,
  SimilarityMatch,
} from "./types";
import { jaccard, normalizeForMatch, trigrams } from "./text";

/** Short generic stems ("Что обозначено цифрой 17?") must not merge on text alone. */
function isGenericStem(stem: string): boolean {
  const n = normalizeForMatch(stem);
  return n.length < 45 && /(цифр|номер|рисун|изображ|стрелк|figure|image|number|labell?ed)/.test(n);
}

function optionSet(q: { options: { normalizedText: string }[] }): Set<string> {
  return new Set(q.options.map((o) => o.normalizedText).filter(Boolean));
}

/**
 * Six-level similarity, from exact text to semantic-ish. Only levels with
 * strong evidence auto-merge; looser matches are returned for review.
 */
export function compareQuestions(
  a: { stem: string; normalizedStem: string; options: { normalizedText: string }[]; hasImage: boolean },
  b: { stem: string; normalizedStem: string; options: { normalizedText: string }[]; hasImage: boolean },
): SimilarityMatch | null {
  const oa = optionSet(a);
  const ob = optionSet(b);
  const optionScore = oa.size || ob.size ? jaccard(oa, ob) : 1;
  const generic = isGenericStem(a.stem) || isGenericStem(b.stem) || a.hasImage || b.hasImage;

  if (a.stem === b.stem && a.stem) {
    const ok = optionScore >= (generic ? 0.99 : 0.75);
    return { level: 1, score: 1, stemScore: 1, optionScore, autoMerge: ok, reason: ok ? "exact text" : "exact stem, different options" };
  }
  if (a.normalizedStem && a.normalizedStem === b.normalizedStem) {
    const ok = optionScore >= (generic ? 0.99 : 0.75);
    return { level: 2, score: 0.98, stemScore: 1, optionScore, autoMerge: ok, reason: ok ? "normalized text" : "normalized stem, different options" };
  }
  const stemScore = jaccard(trigrams(a.normalizedStem), trigrams(b.normalizedStem));
  if (stemScore < 0.55) return null;
  const score = 0.65 * stemScore + 0.35 * optionScore;
  if (stemScore >= 0.9 && optionScore >= 0.9 && !generic) {
    return { level: 3, score, stemScore, optionScore, autoMerge: true, reason: "near-identical text + same options" };
  }
  if (stemScore >= 0.8 && optionScore >= 0.99) {
    return { level: 4, score, stemScore, optionScore, autoMerge: !generic, reason: "same options, reworded stem" };
  }
  if (stemScore >= 0.75 && optionScore >= 0.6) {
    return { level: 5, score, stemScore, optionScore, autoMerge: false, reason: "similar stem and options" };
  }
  if (stemScore >= 0.6) return { level: 6, score, stemScore, optionScore, autoMerge: false, reason: "similar wording" };
  return null;
}

/** Existing canonical question as loaded from storage (minimal shape). */
export interface CanonicalSeed {
  key: string;
  stem: string;
  normalizedStem: string;
  questionType: CanonicalQuestionDraft["questionType"];
  hasImage: boolean;
  options: { key: string; text: string; normalizedText: string; correctVotes: number; incorrectVotes: number; selectedCount: number }[];
  instanceIds: string[];
  manualLock?: boolean;
}

export interface AggregationResult {
  canonicals: CanonicalQuestionDraft[];
  /** instanceId → canonical key */
  assignment: Map<string, string>;
  /** Possible duplicates that were NOT auto-merged. */
  candidates: { instanceId: string; canonicalKey: string; match: SimilarityMatch }[];
}

function blockingKeys(normStem: string): string[] {
  const toks = normStem.split(" ").filter((t) => t.length >= 4);
  const sorted = [...new Set(toks)].sort((a, b) => b.length - a.length).slice(0, 4);
  return sorted.length ? sorted : [normStem.slice(0, 12)];
}

/**
 * Groups instances into canonical questions (across attempts and documents)
 * and aggregates answer evidence per option text — option order and labels
 * are never used for identity.
 */
export function aggregate(instances: QuestionInstance[], seeds: CanonicalSeed[], makeKey: () => string): AggregationResult {
  type Work = CanonicalSeed & { members: QuestionInstance[] };
  const works: Work[] = seeds.map((s) => ({ ...s, options: s.options.map((o) => ({ ...o })), members: [] }));
  const index = new Map<string, Set<number>>();
  const addToIndex = (i: number) => {
    for (const k of blockingKeys(works[i].normalizedStem)) {
      if (!index.has(k)) index.set(k, new Set());
      index.get(k)!.add(i);
    }
  };
  works.forEach((_, i) => addToIndex(i));

  const assignment = new Map<string, string>();
  const candidates: AggregationResult["candidates"] = [];

  for (const q of instances) {
    if (q.extractionStatus === "FAILED" || !q.stem) continue;
    const probe = { stem: q.stem, normalizedStem: q.normalizedStem, options: q.options, hasImage: q.images.length > 0 };
    const pool = new Set<number>();
    for (const k of blockingKeys(q.normalizedStem)) for (const i of index.get(k) ?? []) pool.add(i);

    let best: { i: number; m: SimilarityMatch } | null = null;
    for (const i of pool) {
      const w = works[i];
      if (w.questionType !== q.questionType && !(["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(w.questionType) && ["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(q.questionType))) continue;
      const m = compareQuestions(probe, w);
      if (m && (!best || m.score > best.m.score)) best = { i, m };
    }

    let target: Work;
    if (best && best.m.autoMerge) {
      target = works[best.i];
    } else {
      target = {
        key: makeKey(),
        stem: q.stem,
        normalizedStem: q.normalizedStem,
        questionType: q.questionType,
        hasImage: q.images.length > 0,
        options: [],
        instanceIds: [],
        members: [],
      };
      works.push(target);
      addToIndex(works.length - 1);
      if (best) candidates.push({ instanceId: q.id, canonicalKey: works[best.i].key, match: best.m });
    }

    target.members.push(q);
    target.instanceIds.push(q.id);
    assignment.set(q.id, target.key);

    // Merge options by normalized text (order/labels irrelevant)
    for (const o of q.options) {
      let co = target.options.find((x) => x.normalizedText === o.normalizedText);
      if (!co) {
        const fuzzy = target.options.find((x) => jaccard(trigrams(x.normalizedText), trigrams(o.normalizedText)) >= 0.92);
        co = fuzzy;
      }
      if (!co) {
        co = { key: makeKey(), text: o.text, normalizedText: o.normalizedText, correctVotes: 0, incorrectVotes: 0, selectedCount: 0 };
        target.options.push(co);
      }
      const extras = co as typeof co & { instanceOptionIds?: string[] };
      extras.instanceOptionIds = [...(extras.instanceOptionIds ?? []), o.id];
      if (q.answer.correctOptionIds.includes(o.id)) co.correctVotes++;
      if (q.answer.incorrectOptionIds.includes(o.id)) co.incorrectVotes++;
      if (q.answer.selectedOptionIds.includes(o.id)) co.selectedCount++;
    }
  }

  const canonicals: CanonicalQuestionDraft[] = works
    .filter((w) => w.members.length > 0)
    .map((w) => resolveCanonical(w, w.members));

  return { canonicals, assignment, candidates };
}

function resolveCanonical(w: CanonicalSeed, members: QuestionInstance[]): CanonicalQuestionDraft {
  const conflicts: string[] = [];
  const reasons: string[] = [];
  const options: CanonicalOption[] = w.options.map((o) => ({
    key: o.key,
    text: o.text,
    normalizedText: o.normalizedText,
    correctVotes: o.correctVotes,
    incorrectVotes: o.incorrectVotes,
    selectedCount: o.selectedCount,
    instanceOptionIds: (o as { instanceOptionIds?: string[] }).instanceOptionIds ?? [],
  }));

  for (const o of options) {
    if (o.correctVotes > 0 && o.incorrectVotes > 0) conflicts.push(`Вариант «${o.text}» отмечен и как верный (${o.correctVotes}), и как неверный (${o.incorrectVotes})`);
  }

  const completeMembers = members.filter((m) => m.answer.complete && (m.answer.status === "CONFIRMED_BY_DOCUMENT" || m.answer.status === "CONFIRMED_BY_SCORE"));
  const multiType = members.some((m) => m.questionType === "MULTIPLE_CHOICE");
  const singleType = !multiType;

  let correctKeys = options.filter((o) => o.correctVotes > 0 && o.incorrectVotes === 0).map((o) => o.key);
  let status: AnswerStatus = "UNRESOLVED";
  let confidence = 0;

  // Complete sets reported by different instances must agree.
  const completeSets = completeMembers.map((m) => {
    const ids = new Set(m.answer.correctOptionIds);
    return options.filter((o) => o.instanceOptionIds.some((id) => ids.has(id))).map((o) => o.key).sort().join("|");
  });
  const distinctSets = new Set(completeSets);
  if (distinctSets.size > 1) conflicts.push(`Разные полные наборы правильных ответов в ${completeSets.length} попытках`);

  if (conflicts.length) {
    status = "CONFLICT";
    confidence = 0.3;
  } else if (completeMembers.length > 0) {
    correctKeys = completeSets[0] ? completeSets[0].split("|").filter(Boolean) : correctKeys;
    const byDoc = completeMembers.some((m) => m.answer.status === "CONFIRMED_BY_DOCUMENT");
    status = completeMembers.length >= 2 || (members.length >= 2 && correctKeys.length) ? "CONFIRMED_BY_MULTIPLE_ATTEMPTS" : byDoc ? "CONFIRMED_BY_DOCUMENT" : "CONFIRMED_BY_SCORE";
    if (completeMembers.length === 1 && members.length === 1) status = byDoc ? "CONFIRMED_BY_DOCUMENT" : "CONFIRMED_BY_SCORE";
    confidence = Math.min(0.99, Math.max(...completeMembers.map((m) => m.answer.confidence)) + 0.02 * (completeMembers.length - 1));
    reasons.push(`${completeMembers.length} попыт(ок) с полным подтверждённым набором`);
  } else if (singleType && options.length >= 2) {
    // Single choice: eliminate options proven wrong across attempts.
    const remaining = options.filter((o) => o.incorrectVotes === 0);
    if (correctKeys.length === 1) {
      status = "CONFIRMED_BY_MULTIPLE_ATTEMPTS";
      confidence = members.length >= 2 ? 0.85 : 0.7;
      reasons.push("Единственный вариант с подтверждением ✓");
      if (members.length < 2) status = "NEEDS_REVIEW";
    } else if (remaining.length === 1 && options.length >= 3 && members.length >= 2) {
      correctKeys = [remaining[0].key];
      status = "CONFIRMED_BY_MULTIPLE_ATTEMPTS";
      confidence = 0.75;
      reasons.push("Все остальные варианты опровергнуты в разных попытках");
    } else {
      status = correctKeys.length ? "NEEDS_REVIEW" : "UNRESOLVED";
      confidence = correctKeys.length ? 0.5 : 0;
    }
  } else if (correctKeys.length) {
    // Multiple choice with only partial evidence: union of ✓ across attempts.
    const uncertain = options.filter((o) => o.correctVotes === 0 && o.incorrectVotes === 0);
    status = uncertain.length === 0 && members.length >= 2 ? "CONFIRMED_BY_MULTIPLE_ATTEMPTS" : "NEEDS_REVIEW";
    confidence = status === "NEEDS_REVIEW" ? 0.5 : 0.8;
    reasons.push(uncertain.length ? `${uncertain.length} вариант(ов) без доказательств` : "Все варианты определены по совокупности попыток");
  }

  const ordering = members.find((m) => m.answer.correctOrder)?.answer.correctOrder ?? null;
  const correctOrder = ordering
    ? ordering.map((id) => options.find((o) => o.instanceOptionIds.includes(id))?.key).filter((k): k is string => !!k)
    : null;
  const matchingSrc = members.find((m) => m.answer.matching)?.answer.matching ?? null;
  const matching = matchingSrc
    ? Object.fromEntries(
        Object.entries(matchingSrc)
          .map(([id, v]) => [options.find((o) => o.instanceOptionIds.includes(id))?.key, v] as const)
          .filter((e): e is [string, string] => !!e[0]),
      )
    : null;
  const textAnswer = members.find((m) => m.answer.textAnswer)?.answer.textAnswer ?? null;
  if ((correctOrder || matching || textAnswer) && status === "UNRESOLVED") {
    const src = members.find((m) => m.answer.correctOrder || m.answer.matching || m.answer.textAnswer)!;
    status = src.answer.status;
    confidence = src.answer.confidence;
  }

  return {
    key: w.key,
    stem: w.stem,
    normalizedStem: w.normalizedStem,
    questionType: multiType ? "MULTIPLE_CHOICE" : members[0].questionType,
    options,
    instanceIds: members.map((m) => m.id),
    correctKeys,
    correctOrder,
    matching,
    textAnswer,
    answerStatus: status,
    confidence: Number(confidence.toFixed(2)),
    conflicts,
    reasons,
    hasImage: members.some((m) => m.images.length > 0),
    mergeConfidence: members.length > 1 ? 0.9 : 1,
  };
}
