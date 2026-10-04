"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ImageIcon, Minus, Table2, X } from "lucide-react";
import { AnswerStatusPill, Confidence, Pill, cx } from "./ui";
import { EVIDENCE_LABEL, EXTRACTION_STATUS_LABEL, QUESTION_TYPE_LABEL } from "@/lib/ingestion/labels";
import type { QuestionInstance } from "@/lib/ingestion/types";

export function InstanceCard({ q, showSource }: { q: QuestionInstance & { canonicalId?: string | null; filename?: string | null }; showSource?: boolean }) {
  const [open, setOpen] = useState(false);
  const correct = new Set(q.answer.correctOptionIds);
  const incorrect = new Set(q.answer.incorrectOptionIds);
  const selected = new Set(q.answer.selectedOptionIds);
  const orderIndex = q.answer.correctOrder ? new Map(q.answer.correctOrder.map((id, i) => [id, i + 1])) : null;

  return (
    <article className="flex flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-mono tabular-nums">#{q.questionNumber ?? q.sequence}</span>
        <span>стр. {q.pages.join(", ")}</span>
        {showSource && q.filename && <span className="max-w-[16rem] truncate">· {q.filename}</span>}
        <Pill tone="info">{QUESTION_TYPE_LABEL[q.questionType] ?? q.questionType}</Pill>
        {q.extractionStatus !== "PARSED" && <Pill tone={q.extractionStatus === "FAILED" ? "bad" : "warn"}>{EXTRACTION_STATUS_LABEL[q.extractionStatus]}</Pill>}
        <AnswerStatusPill status={q.answer.status} />
        {q.score && q.score.kind !== "UNKNOWN" && (
          <span className="tabular-nums">
            балл {q.score.earned ?? "—"}
            {q.score.max != null ? ` / ${q.score.max}` : ""}
          </span>
        )}
        <span className="ml-auto">
          <Confidence value={q.answer.confidence} />
        </span>
      </header>

      <p className="text-sm leading-relaxed text-slate-900 dark:text-slate-100 text-pretty whitespace-pre-line">{q.stem || <em className="text-slate-400">Текст вопроса не найден</em>}</p>
      {q.instruction && <p className="text-xs italic text-slate-500">{q.instruction}</p>}

      {(q.images.length > 0 || q.tables.length > 0 || q.formulas.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {q.images.map((im) => (
            <span key={im.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Изображение (стр. {im.page}){im.referencedLabel ? ` · метка ${im.referencedLabel}` : ""}
            </span>
          ))}
          {q.tables.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Таблица {t.rows.length}×{t.rows[0]?.cells.length ?? 0}
            </span>
          ))}
          {q.formulas.map((f) => (
            <code key={f.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">
              {f.latex ?? f.raw}
            </code>
          ))}
        </div>
      )}

      {q.options.length > 0 && (
        <ol className="flex flex-col gap-1">
          {q.options.map((o) => {
            const isCorrect = correct.has(o.id);
            const isWrong = incorrect.has(o.id);
            return (
              <li
                key={o.id}
                className={cx(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm",
                  isCorrect ? "border-emerald-500/40 bg-emerald-500/5" : isWrong ? "border-red-500/25 bg-red-500/5" : "border-slate-200 dark:border-slate-800",
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {isCorrect ? <Check className="h-4 w-4 text-emerald-600" /> : isWrong ? <X className="h-4 w-4 text-red-500" /> : <Minus className="h-3 w-3 text-slate-300 dark:text-slate-600" />}
                </span>
                <span className="sr-only">{isCorrect ? "Правильный:" : isWrong ? "Неправильный:" : ""}</span>
                {o.label && <span className="font-mono text-xs text-slate-500 mt-0.5">{o.label}.</span>}
                <span className="flex-1 leading-relaxed">
                  {o.text}
                  {o.pairText && <span className="text-slate-500"> → {q.answer.matching?.[o.id] ?? o.pairText}</span>}
                </span>
                {orderIndex?.has(o.id) && <Pill tone="ok">{orderIndex.get(o.id)}</Pill>}
                {selected.has(o.id) && <Pill tone="muted">выбран</Pill>}
              </li>
            );
          })}
        </ol>
      )}

      {q.answer.textAnswer && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1.5 text-sm">
          <span className="text-xs text-slate-500">Ответ: </span>
          {q.answer.textAnswer}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
          <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          Доказательства ({q.evidence.length}) и сырой текст
        </button>
        {q.canonicalId && (
          <Link href={`/ingest/questions/${q.canonicalId}`} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            Канонический вопрос →
          </Link>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950/60">
          {q.answer.reasons.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
              {q.answer.reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          )}
          {q.evidence.length > 0 && (
            <table className="w-full">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Тип</th>
                  <th className="py-1 pr-3 font-medium">Вариант</th>
                  <th className="py-1 pr-3 font-medium">Знак</th>
                  <th className="py-1 pr-3 font-medium">Уверенность</th>
                  <th className="py-1 font-medium">Сырое значение</th>
                </tr>
              </thead>
              <tbody>
                {q.evidence.map((e) => {
                  const opt = q.options.find((o) => o.id === e.optionId);
                  return (
                    <tr key={e.id} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="py-1 pr-3">{EVIDENCE_LABEL[e.type] ?? e.type}</td>
                      <td className="max-w-[12rem] truncate py-1 pr-3">{opt ? opt.label ?? opt.text : "весь вопрос"}</td>
                      <td className="py-1 pr-3">{e.polarity === true ? "верно" : e.polarity === false ? "неверно" : "—"}</td>
                      <td className="py-1 pr-3 tabular-nums">{Math.round(e.confidence * 100)}%</td>
                      <td className="max-w-[16rem] truncate py-1 font-mono">{e.rawValue}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {q.feedback && (
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">Отзыв: </span>
              {q.feedback}
            </p>
          )}
          {q.issues.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-amber-700 dark:text-amber-400">
              {q.issues.map((r, i) => (
                <li key={i}>! {r}</li>
              ))}
            </ul>
          )}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">{q.rawText}</pre>
        </div>
      )}
    </article>
  );
}
