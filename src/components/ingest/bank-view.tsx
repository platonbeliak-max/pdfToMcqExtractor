"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ImageIcon, Search } from "lucide-react";
import { AnswerStatusPill, Button, Confidence, Empty, Panel, Pill, fetcher, selectCls } from "./ui";
import { ANSWER_STATUS_LABEL, QUESTION_TYPE_LABEL, SUBJECTS, subjectName } from "@/lib/ingestion/labels";
import type { CanonicalOption } from "@/lib/ingestion/types";

interface Row {
  id: string;
  stem: string;
  subjectSlug: string | null;
  questionType: string;
  options: CanonicalOption[];
  correctKeys: string[];
  textAnswer: string | null;
  answerStatus: string;
  confidence: number;
  hasImage: boolean;
  instanceCount: number;
  documentIds: string[];
  inBank: boolean;
  reviewStatus: string;
}

const PAGE = 50;

export function BankView() {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [inBank, setInBank] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDeferredValue(q);

  const params = new URLSearchParams();
  if (dq.trim()) params.set("q", dq.trim());
  if (subject) params.set("subject", subject);
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  if (inBank) params.set("inBank", inBank);
  params.set("limit", String(PAGE));
  params.set("offset", String(page * PAGE));

  const { data, error, isLoading } = useSWR<{ items: Row[]; total: number; statusCounts: Record<string, number> }>(`/api/ingest/questions?${params}`, fetcher, { keepPreviousData: true });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Банк вопросов</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Канонические вопросы, объединённые из всех попыток и документов. В банк попадают только вопросы с подтверждённым ответом.</p>
      </div>

      {data && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.statusCounts).map(([s, n]) => (
            <button key={s} type="button" onClick={() => reset(setStatus)(status === s ? "" : s)} className={status === s ? "rounded-md ring-2 ring-blue-500" : "rounded-md"}>
              <span className="flex items-center gap-1">
                <AnswerStatusPill status={s} />
                <span className="pr-1 text-xs tabular-nums text-slate-500">{n}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Panel
        title={data ? `Найдено: ${data.total}` : "Вопросы"}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="relative">
              <span className="sr-only">Поиск</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Поиск по тексту" className={`${selectCls} w-48 pl-8`} />
            </label>
            <select aria-label="Предмет" className={selectCls} value={subject} onChange={(e) => reset(setSubject)(e.target.value)}>
              <option value="">Все предметы</option>
              {SUBJECTS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
            <select aria-label="Статус ответа" className={selectCls} value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
              <option value="">Любой статус</option>
              {Object.entries(ANSWER_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select aria-label="Тип вопроса" className={selectCls} value={type} onChange={(e) => reset(setType)(e.target.value)}>
              <option value="">Любой тип</option>
              {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select aria-label="Публикация" className={selectCls} value={inBank} onChange={(e) => reset(setInBank)(e.target.value)}>
              <option value="">Все</option>
              <option value="1">В банке</option>
              <option value="0">Не в банке</option>
            </select>
          </div>
        }
      >
        {error ? (
          <Empty>Ошибка: {error.message}</Empty>
        ) : isLoading && !data ? (
          <Empty>Загрузка…</Empty>
        ) : !data?.items.length ? (
          <Empty>Ничего не найдено. Импортируйте документ, чтобы наполнить банк.</Empty>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.items.map((r) => {
              const answer = r.correctKeys.map((k) => r.options.find((o) => o.key === k)?.text).filter(Boolean).join("; ") || r.textAnswer;
              return (
                <li key={r.id}>
                  <Link href={`/ingest/questions/${r.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <AnswerStatusPill status={r.answerStatus} />
                      <Pill tone="info">{QUESTION_TYPE_LABEL[r.questionType] ?? r.questionType}</Pill>
                      {r.subjectSlug && <span>{subjectName(r.subjectSlug)}</span>}
                      <span>
                        · встречается {r.instanceCount}× в {r.documentIds.length} док.
                      </span>
                      {r.hasImage && <ImageIcon className="h-3.5 w-3.5" aria-label="С изображением" />}
                      {r.inBank ? <Pill tone="ok">в банке</Pill> : r.reviewStatus === "REJECTED" ? <Pill tone="bad">отклонён</Pill> : null}
                      <span className="ml-auto">
                        <Confidence value={r.confidence} />
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-900 dark:text-slate-100">{r.stem}</p>
                    {answer && <p className="line-clamp-1 text-xs text-emerald-700 dark:text-emerald-400">Ответ: {answer}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
            <span className="tabular-nums">
              {page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} из {data.total}
            </span>
            <div className="flex gap-2">
              <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <Button disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>
                Далее
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
