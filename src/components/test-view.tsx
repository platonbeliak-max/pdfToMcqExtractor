"use client";

import React, { useMemo, useState } from "react";
import { StructuredQuestion, answerKeys, isFigureQuestion, type MatchingAnswer, type SequenceAnswer } from "@/types/question";
import { useT } from "@/lib/i18n";
import { CheckCircle2, XCircle, RotateCcw, Play, ArrowRight, ClipboardList, Eye, Lightbulb } from "lucide-react";
import { FigureImage } from "./figure-image";
import { dedupeKey, hasAnswer } from "@/lib/answerable";
import { BLANK, clozeAnswers } from "@/lib/cloze";

interface TestItem {
  id: string;
  text: string;
  options: { key: string; text: string }[];
  correct: string[];
  textAnswer: string;
  figure?: { imageId?: string; captions: string[] };
  sequence?: SequenceAnswer;
  matching?: MatchingAnswer;
  /** Illustration shown above a regular (non-labelling) question. */
  imageId?: string;
}

/** `slots` holds the chosen position number (sequence) or value (matching) per option key. */
type Answer = { picked: string[]; typed: string; labels?: Record<string, string>; slots?: Record<string, string> };
export type TestMode = "all" | "text" | "fig";

const byNumber = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, undefined, { numeric: true });

const norm = (s: string) =>
  s
    .replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?«»"'()]/g, "")
    .trim();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPool(questions: StructuredQuestion[]): { pool: TestItem[]; skipped: number } {
  const seen = new Set<string>();
  const pool: TestItem[] = [];
  let skipped = 0;
  for (const q of questions) {
    const key = dedupeKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    const correct = answerKeys(q.answer?.key).filter((k) => q.options.some((o) => o.key === k));
    const textAnswer = !q.options.length ? (q.answer?.text || "").trim() : "";
    if (!hasAnswer(q)) {
      skipped++;
      continue;
    }
    if (q.sequence || q.matching) {
      pool.push({ id: q.id, text: q.question.text, options: q.options, correct: [], textAnswer: "", sequence: q.sequence, matching: q.matching, imageId: q.imageId });
      continue;
    }
    // A picture with an answer key is an ordinary question illustrated by it; only unkeyed pictures are labelling tasks.
    if (isFigureQuestion(q) && q.options.length >= 2 && (q.tags?.includes("figure") || !correct.length)) {
      const labels = [...q.options].sort(byNumber);
      pool.push({
        id: q.id,
        text: q.question.text,
        options: labels,
        correct: labels.map((o) => o.key),
        textAnswer: "",
        figure: { imageId: q.imageId, captions: [...new Set(labels.map((o) => o.text))] },
      });
      continue;
    }
    pool.push({ id: q.id, text: q.question.text, options: q.options, correct, textAnswer, imageId: q.imageId });
  }
  return { pool, skipped };
}

function expectedSlot(item: TestItem, key: string): string {
  if (item.sequence) return String(item.sequence[key] ?? "");
  return item.matching?.pairs[key] ?? "";
}

function slotRight(item: TestItem, a: Answer | undefined, key: string): boolean {
  const chosen = a?.slots?.[key] ?? "";
  if (!chosen) return false;
  if (item.sequence) return chosen === expectedSlot(item, key);
  return norm(chosen) === norm(expectedSlot(item, key));
}

function correctAnswerText(item: TestItem): string {
  if (item.sequence)
    return [...item.options]
      .sort((x, y) => (item.sequence![x.key] ?? 99) - (item.sequence![y.key] ?? 99))
      .map((o) => `${item.sequence![o.key]}) ${o.text}`)
      .join("; ");
  if (item.matching) return item.options.map((o) => `${o.text} → ${item.matching!.pairs[o.key]}`).join("; ");
  if (item.figure) return item.options.map((o) => `${o.key} — ${o.text}`).join("; ");
  if (item.correct.length) return item.options.filter((o) => item.correct.includes(o.key)).map((o) => o.text).join("; ");
  return item.textAnswer;
}

function blankAnswers(item: TestItem): string[] | null {
  if (item.correct.length || item.figure || item.sequence || item.matching) return null;
  return clozeAnswers(item.text, item.textAnswer);
}

function isRight(item: TestItem, a: Answer | undefined): boolean {
  if (!a) return false;
  const blanks = blankAnswers(item);
  if (blanks) return blanks.every((w, i) => textMatches(a.labels?.[`b${i}`] ?? "", w));
  if (item.sequence || item.matching) return item.options.every((o) => slotRight(item, a, o.key));
  if (item.figure) return item.options.every((o) => textMatches(a.labels?.[o.key] ?? "", o.text));
  if (item.correct.length) {
    const p = [...a.picked].sort().join(",");
    return p === [...item.correct].sort().join(",");
  }
  return textMatches(a.typed, item.textAnswer);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Accepts ё/е, Latin look-alikes, numeric "0,5"="0.5" and small typos (~1 per 6 letters). */
const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", b: "в", h: "н",
};

function foldMixedAlphabet(s: string): string {
  return s.replace(/[\p{L}]+/gu, (word) =>
    /[\u0400-\u04FF]/.test(word) && /[a-z]/.test(word)
      ? [...word].map((ch) => LATIN_TO_CYRILLIC[ch] ?? ch).join("")
      : word,
  );
}

function asNumber(s: string): number | null {
  const compact = s.replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF\s]+/g, "").replace(/(\d),(\d)/g, "$1.$2");
  return /^-?\d+(\.\d+)?$/.test(compact) ? Number(compact) : null;
}

function textMatches(typed: string, expected: string): boolean {
  const canon = (s: string) => norm(foldMixedAlphabet(s.toLowerCase().replace(/ё/g, "е"))).replace(/[\s\-–—]/g, "");
  const numTyped = asNumber(typed);
  const numExpected = asNumber(expected);
  if (numExpected !== null) return numTyped !== null && numTyped === numExpected;
  const a = canon(typed);
  const b = canon(expected);
  if (!a) return false;
  if (a === b) return true;
  return editDistance(a, b) <= Math.floor(b.length / 6);
}

export function TestView({
  questions,
  onGoUpload,
  initialMode = "all",
}: {
  questions: StructuredQuestion[];
  onGoUpload: () => void;
  initialMode?: TestMode;
}) {
  return <TestRunner questions={questions} onGoUpload={onGoUpload} initialMode={initialMode} picker={null} />;
}

function TestRunner({
  questions,
  onGoUpload,
  initialMode,
  picker,
}: {
  questions: StructuredQuestion[];
  onGoUpload: () => void;
  initialMode: TestMode;
  picker: React.ReactNode;
}) {
  const { t } = useT();
  const { pool: fullPool, skipped } = useMemo(() => buildPool(questions), [questions]);
  const [mode, setMode] = useState<TestMode>(initialMode);
  const hasPicture = (it: TestItem) => !!(it.figure || it.imageId);
  const figCount = fullPool.filter(hasPicture).length;
  const pool = useMemo(
    () => fullPool.filter((it) => (mode === "all" ? true : mode === "fig" ? hasPicture(it) : !hasPicture(it))),
    [fullPool, mode],
  );

  const [count, setCount] = useState<number>(20);
  const [shuffleOpts, setShuffleOpts] = useState(true);
  const [items, setItems] = useState<TestItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [hints, setHints] = useState<Record<string, true>>({});

  const start = (source: TestItem[]) => {
    const n = count === 0 ? source.length : Math.min(count, source.length);
    const chosen = shuffle(source)
      .slice(0, n)
      .map((it) => {
        if (it.figure) return { ...it, figure: { ...it.figure, captions: shuffle(it.figure.captions) } };
        if (it.matching) return { ...it, options: shuffleOpts ? shuffle(it.options) : it.options, matching: { ...it.matching, choices: shuffle(it.matching.choices) } };
        return shuffleOpts ? { ...it, options: shuffle(it.options) } : it;
      });
    setItems(chosen);
    setIdx(0);
    setAnswers({});
    setRevealed({});
    setHints({});
    setChecked(false);
    setFinished(false);
  };

  if (fullPool.length === 0) {
    return (
      <div className="max-w-xl mx-auto p-10 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="text-left mb-8">{picker}</div>
        <ClipboardList className="w-10 h-10 text-blue-600 mx-auto mb-3" />
        <h2 className="font-bold text-slate-900 dark:text-slate-100">{t("testEmptyT")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">{t("testEmptyD")}</p>
        <button
          type="button"
          onClick={onGoUpload}
          className="mt-5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
        >
          {t("navExtract")}
        </button>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="max-w-xl mx-auto p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 text-balance">{t("testSetupT")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {t("testPool", { n: pool.length })}
            {skipped > 0 && " " + t("testSkipped", { n: skipped })}
          </p>
        </div>

        {picker}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{t("testMode")}</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", t("testModeAll")],
                ["text", t("testModeText")],
                ["fig", t("testModeFig", { n: figCount })],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                  mode === m
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "fig" && figCount === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">{t("testFigNone")}</p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{t("testCount")}</legend>
          <div className="flex flex-wrap gap-2">
            {[10, 20, 50, 100, 0].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                  count === n
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500"
                }`}
              >
                {n === 0 ? t("testAll", { n: pool.length }) : n}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={shuffleOpts} onChange={(e) => setShuffleOpts(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          {t("testShuffle")}
        </label>

        <button
          type="button"
          disabled={pool.length === 0}
          onClick={() => start(pool)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold"
        >
          <Play className="w-4 h-4" />
          {t("testStart")}
        </button>
      </div>
    );
  }

  if (finished) {
    const wrong = items.filter((it) => revealed[it.id] || !isRight(it, answers[it.id]));
    const score = items.length - wrong.length;
    const pct = Math.round((score / items.length) * 100);
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{t("testResult")}</p>
          <p className="text-5xl font-extrabold text-slate-900 dark:text-slate-100 mt-2">{pct}%</p>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{t("testScore", { s: score, n: items.length })}</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {wrong.length > 0 && (
              <button type="button" onClick={() => start(wrong)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm">
                <RotateCcw className="w-4 h-4" />
                {t("testRetryWrong", { n: wrong.length })}
              </button>
            )}
            <button type="button" onClick={() => setItems(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              {t("testNew")}
            </button>
          </div>
        </div>

        {wrong.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100">{t("testMistakes")}</h3>
            {wrong.map((it) => (
              <div key={it.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-relaxed">{it.text}</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 leading-relaxed">
                  {t("correctAnswer")}: {correctAnswerText(it)}
                </p>
              </div>
            ))}
          </section>
        )}
      </div>
    );
  }

  const item = items[idx];
  const ans = answers[item.id] ?? { picked: [], typed: "" };
  const multi = !item.figure && item.correct.length > 1;
  const wasRevealed = !!revealed[item.id];
  const right = checked && !wasRevealed && isRight(item, ans);
  const reveal = () => {
    setRevealed({ ...revealed, [item.id]: true });
    setChecked(true);
  };
  const structured = !!(item.sequence || item.matching);
  const blanks = blankAnswers(item);
  const setSlot = (key: string, value: string) =>
    setAnswers({ ...answers, [item.id]: { ...ans, slots: { ...ans.slots, [key]: value } } });
  const setBlank = (i: number, value: string) =>
    setAnswers({ ...answers, [item.id]: { ...ans, labels: { ...ans.labels, [`b${i}`]: value } } });
  const textParts = blanks ? item.text.split(BLANK) : [];
  const canCheck = blanks
    ? blanks.every((_, i) => ans.labels?.[`b${i}`]?.trim())
    : structured
    ? item.options.every((o) => ans.slots?.[o.key])
    : item.figure
    ? item.options.some((o) => ans.labels?.[o.key]?.trim())
    : item.correct.length
      ? ans.picked.length > 0
      : ans.typed.trim().length > 0;

  const toggle = (key: string) => {
    if (checked) return;
    const picked = multi ? (ans.picked.includes(key) ? ans.picked.filter((k) => k !== key) : [...ans.picked, key]) : [key];
    setAnswers({ ...answers, [item.id]: { ...ans, picked } });
  };

  const next = () => {
    if (idx + 1 >= items.length) setFinished(true);
    else {
      setIdx(idx + 1);
      setChecked(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-bold text-slate-700 dark:text-slate-300">
          {t("question")} {idx + 1} / {items.length}
        </span>
        <button type="button" onClick={() => setFinished(true)} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 font-semibold">
          {t("testFinish")}
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${((idx + (checked ? 1 : 0)) / items.length) * 100}%` }} />
      </div>

      <div className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-5">
        <div>
          {blanks ? (
            <>
              <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-3">{t("testBlankHint")}</p>
              <p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 leading-loose text-pretty">
                {textParts.map((part, i) => {
                  if (i === textParts.length - 1) return <span key={i}>{part}</span>;
                  const value = ans.labels?.[`b${i}`] ?? "";
                  const ok = checked && textMatches(value, blanks[i]);
                  const tone = !checked
                    ? "border-blue-500 focus:border-blue-600"
                    : ok
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100"
                      : "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100";
                  return (
                    <span key={i}>
                      {part}
                      <span className="inline-flex flex-col align-middle mx-1 my-1">
                        <input
                          id={`blank-${i}`}
                          aria-label={t("testBlank", { n: i + 1 })}
                          autoComplete="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          value={value}
                          disabled={checked}
                          onChange={(e) => setBlank(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
                            e.preventDefault();
                            if (checked) return next();
                            const nextInput = document.getElementById(`blank-${i + 1}`);
                            if (nextInput) nextInput.focus();
                            else if (canCheck) setChecked(true);
                          }}
                          style={{ width: `${Math.max(6, Math.min(16, blanks[i].length + 2))}ch` }}
                          className={`min-h-11 px-2 py-1 rounded-lg border-2 bg-transparent text-base font-semibold text-slate-900 dark:text-slate-100 outline-none ${tone}`}
                        />
                        {checked && !ok && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 leading-tight mt-0.5">{blanks[i]}</span>}
                      </span>
                    </span>
                  );
                })}
              </p>
            </>
          ) : (
            <p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 leading-relaxed text-pretty">{item.text}</p>
          )}
          {multi && (
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-2">
              {t("testMulti", { n: item.correct.length })} · {t("testMultiPicked", { k: ans.picked.length, n: item.correct.length })}
            </p>
          )}
        </div>
        {!item.figure && item.imageId && <FigureImage imageId={item.imageId} className="max-h-96 object-contain" />}

        {structured ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{item.sequence ? t("testSeqHint") : t("testMatchHint")}</p>
            <ol className="flex flex-col gap-2">
              {item.options.map((o) => {
                const chosen = ans.slots?.[o.key] ?? "";
                const ok = slotRight(item, ans, o.key);
                const tone = !checked
                  ? chosen
                    ? "border-blue-600"
                    : "border-slate-200 dark:border-slate-700"
                  : ok
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-red-500 bg-red-50 dark:bg-red-950/40";
                const choices = item.sequence ? item.options.map((_, i) => String(i + 1)) : item.matching!.choices;
                const taken = new Set(Object.entries(ans.slots ?? {}).filter(([k]) => k !== o.key).map(([, v]) => v));
                return (
                  <li
                    key={o.key}
                    className={`flex gap-3 p-3 rounded-2xl border-2 ${tone} ${item.sequence ? "items-center" : "flex-col sm:flex-row sm:flex-wrap sm:items-center"}`}
                  >
                    {item.sequence && (
                      <select
                        aria-label={t("testPosition", { s: o.text })}
                        value={chosen}
                        disabled={checked}
                        onChange={(e) => setSlot(o.key, e.target.value)}
                        className="w-16 shrink-0 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-blue-600 outline-none"
                      >
                        <option value="">{t("testPickNum")}</option>
                        {choices.map((c) => (
                          <option key={c} value={c}>
                            {taken.has(c) ? `${c} ·` : c}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="flex-1 text-sm leading-relaxed text-slate-800 dark:text-slate-200">{o.text}</span>
                    {item.matching && (
                      <select
                        aria-label={t("testPosition", { s: o.text })}
                        value={chosen}
                        disabled={checked}
                        onChange={(e) => setSlot(o.key, e.target.value)}
                        className="w-full sm:w-64 shrink-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 outline-none"
                      >
                        <option value="">{t("testPickMatch")}</option>
                        {choices.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                    {checked && (
                      <span className="inline-flex items-center gap-1.5 shrink-0 text-xs font-bold">
                        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                        {!ok && item.sequence && <span className="text-emerald-700 dark:text-emerald-400">{expectedSlot(item, o.key)}</span>}
                      </span>
                    )}
                    {checked && !ok && item.matching && (
                      <p className="basis-full text-xs font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed">{expectedSlot(item, o.key)}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : item.figure ? (
          <div className="flex flex-col gap-4">
            {item.figure.imageId && <FigureImage imageId={item.figure.imageId} />}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{t("testFigHint")}</p>
              {!checked && (
                <button
                  type="button"
                  title={t("hFigHint")}
                  aria-expanded={!!hints[item.id]}
                  onClick={() => {
                    const next = { ...hints };
                    if (next[item.id]) delete next[item.id];
                    else next[item.id] = true;
                    setHints(next);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  {hints[item.id] ? t("testFigHintHide") : t("testFigHintShow")}
                </button>
              )}
            </div>
            {hints[item.id] && !checked && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t("testFigHintShow")}>
                {item.figure.captions.map((c) => (
                  <li key={c} className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
                    {c}
                  </li>
                ))}
              </ul>
            )}
            <ol className="flex flex-col gap-2">
              {item.options.map((o) => {
                const chosen = ans.labels?.[o.key] ?? "";
                const ok = textMatches(chosen, o.text);
                const tone = !checked
                  ? "border-slate-200 dark:border-slate-700"
                  : ok
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-red-500 bg-red-50 dark:bg-red-950/40";
                return (
                  <li key={o.key} className={`flex flex-col gap-1.5 p-2.5 rounded-2xl border-2 ${tone}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-900 dark:bg-slate-100 text-slate-50 dark:text-slate-900 text-sm font-bold flex items-center justify-center">
                        {o.key}
                      </span>
                      <label htmlFor={`fig-${o.key}`} className="sr-only">
                        {t("question")} {o.key}
                      </label>
                      <input
                        id={`fig-${o.key}`}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={chosen}
                        disabled={checked}
                        placeholder={t("testFigPick")}
                        onChange={(e) =>
                          setAnswers({ ...answers, [item.id]: { ...ans, labels: { ...ans.labels, [o.key]: e.target.value } } })
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
                          e.preventDefault();
                          if (checked) return next();
                          const inputs = [...document.querySelectorAll<HTMLInputElement>("input[id^='fig-']")];
                          const at = inputs.indexOf(e.currentTarget);
                          if (at >= 0 && at < inputs.length - 1) inputs[at + 1].focus();
                          else if (canCheck) setChecked(true);
                        }}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 outline-none"
                      />
                      {checked && (ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <XCircle className="w-4 h-4 shrink-0 text-red-600" />)}
                    </div>
                    {checked && !ok && <p className="text-xs text-emerald-700 dark:text-emerald-400 pl-10">{o.text}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : item.correct.length ? (
          <div className="flex flex-col gap-2" role={multi ? "group" : "radiogroup"}>
            {item.options.map((o) => {
              const picked = ans.picked.includes(o.key);
              const isCorrect = item.correct.includes(o.key);
              let cls = "border-slate-200 dark:border-slate-700 hover:border-blue-500 text-slate-800 dark:text-slate-200";
              if (!checked && picked) cls = "border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100";
              const missed = checked && isCorrect && !picked;
              if (checked && isCorrect) cls = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100";
              if (missed) cls = "border-dashed border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100";
              if (checked && picked && !isCorrect) cls = "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100";
              return (
                <button
                  key={o.key}
                  type="button"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={picked}
                  onClick={() => toggle(o.key)}
                  className={`flex items-start gap-3 text-left p-3.5 rounded-2xl border-2 transition-colors ${cls}`}
                >
                  <span className={`mt-0.5 w-4 h-4 shrink-0 border-2 ${multi ? "rounded" : "rounded-full"} ${picked ? "bg-current border-current" : "border-slate-400"}`} aria-hidden="true" />
                  <span className="text-sm leading-relaxed">{o.text}</span>
                  {missed && <span className="ml-auto shrink-0 text-xs font-bold text-amber-700 dark:text-amber-400">{t("testMissed")}</span>}
                  {checked && isCorrect && !missed && <CheckCircle2 className="w-4 h-4 ml-auto shrink-0 text-emerald-600" />}
                  {checked && picked && !isCorrect && <XCircle className="w-4 h-4 ml-auto shrink-0 text-red-600" />}
                </button>
              );
            })}
          </div>
        ) : blanks ? null : (
          <div className="flex flex-col gap-2">
            <label htmlFor="typed" className="text-sm font-bold text-slate-700 dark:text-slate-300">{t("answer")}</label>
            <input
              id="typed"
              value={ans.typed}
              disabled={checked}
              onChange={(e) => setAnswers({ ...answers, [item.id]: { ...ans, typed: e.target.value } })}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (checked) next();
                else if (canCheck) setChecked(true);
              }}
              className="px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-slate-100 focus:border-blue-600 outline-none"
            />
            {checked && !right && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400 leading-relaxed">
                {t("correctAnswer")}: {item.textAnswer}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span aria-live="polite" className={`text-sm font-bold ${right ? "text-emerald-600" : wasRevealed ? "text-amber-600" : "text-red-600"}`}>
            {checked ? (wasRevealed ? t("testRevealed") : right ? t("testRight") : t("testWrong")) : ""}
          </span>
          {!checked && (
            <button
              type="button"
              onClick={reveal}
              title={t("hReveal")}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400 font-bold text-sm"
            >
              <Eye className="w-4 h-4" />
              {t("testShowAnswer")}
            </button>
          )}
          {checked ? (
            <button type="button" onClick={next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm">
              {idx + 1 >= items.length ? t("testFinish") : t("testNext")}
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canCheck}
              onClick={() => setChecked(true)}
              title={t("hCheck")}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm"
            >
              {t("testCheck")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
