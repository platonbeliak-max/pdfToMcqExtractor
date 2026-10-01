"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bot, Check, Loader2, Save, X } from "lucide-react";
import { AnswerStatusPill, Button, Confidence, Empty, Panel, Pill, cx, fetcher, selectCls, sendJson } from "./ui";
import { InstanceCard } from "./instance-card";
import { QUESTION_TYPE_LABEL, SUBJECTS, TASK_KIND_LABEL } from "@/lib/ingestion/labels";
import type { CanonicalOption, QuestionInstance } from "@/lib/ingestion/types";

interface Canonical {
  id: string;
  stem: string;
  subjectSlug: string | null;
  topic: string | null;
  questionType: string;
  options: CanonicalOption[];
  correctKeys: string[];
  correctOrder: string[] | null;
  textAnswer: string | null;
  answerStatus: string;
  confidence: number;
  conflicts: string[];
  reasons: string[];
  hasImage: boolean;
  instanceCount: number;
  documentIds: string[];
  inBank: boolean;
  reviewStatus: string;
}

interface Detail {
  canonical: Canonical;
  instances: (QuestionInstance & { filename: string | null })[];
  tasks: { id: number; kind: string; reason: string }[];
}

interface Verification {
  id: number;
  verdict: string;
  confidence: number;
  suggestedKeys: string[] | null;
  notes: string | null;
  model: string | null;
  createdAt: string;
}

const MULTI = new Set(["MULTIPLE_CHOICE", "COMBINATION", "IMAGE_LABELING", "TABLE"]);
const TEXTUAL = new Set(["SHORT_TEXT", "NUMERIC", "FORMULA"]);

export function CanonicalDetail({ id }: { id: string }) {
  const { data, error, isLoading, mutate } = useSWR<Detail>(`/api/ingest/questions/${id}`, fetcher);
  const verif = useSWR<{ items: Verification[] }>(`/api/ingest/questions/${id}/verify`, fetcher);
  const [draft, setDraft] = useState<{ keys: string[]; text: string; type: string; subject: string } | null>(null);
  const [busy, setBusy] = useState<null | "save" | "approve" | "reject" | "verify">(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <Empty>Ошибка: {error.message}</Empty>;
  if (isLoading || !data) return <Empty>Загрузка…</Empty>;
  const c = data.canonical;
  const d = draft ?? { keys: c.correctKeys, text: c.textAnswer ?? "", type: c.questionType, subject: c.subjectSlug ?? "" };
  const multi = MULTI.has(d.type);
  const textual = TEXTUAL.has(d.type) || !c.options.length;

  const toggle = (key: string) => {
    const keys = multi ? (d.keys.includes(key) ? d.keys.filter((k) => k !== key) : [...d.keys, key]) : [key];
    setDraft({ ...d, keys });
  };

  async function run(kind: "save" | "approve" | "reject" | "verify") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "verify") {
        await sendJson(`/api/ingest/questions/${id}/verify`, "POST");
        await verif.mutate();
      } else if (kind === "reject") {
        await sendJson(`/api/ingest/questions/${id}`, "PATCH", { action: "reject" });
        await mutate();
      } else {
        await sendJson(`/api/ingest/questions/${id}`, "PATCH", {
          action: kind === "approve" ? "approve" : undefined,
          correctKeys: d.keys,
          textAnswer: d.text.trim() || null,
          questionType: d.type,
          subjectSlug: d.subject || null,
        });
        setDraft(null);
        await mutate();
        setMsg(kind === "approve" ? "Ответ подтверждён, вопрос опубликован в банк." : "Сохранено.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/ingest/bank" className="text-xs text-slate-500 hover:underline">
          ← Банк вопросов
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <AnswerStatusPill status={c.answerStatus} />
          <Pill tone="info">{QUESTION_TYPE_LABEL[c.questionType] ?? c.questionType}</Pill>
          {c.inBank ? <Pill tone="ok">в банке</Pill> : <Pill>не опубликован</Pill>}
          {c.reviewStatus === "REJECTED" && <Pill tone="bad">отклонён</Pill>}
          <span className="text-xs text-slate-500">
            {c.instanceCount} экз. · {c.documentIds.length} док.
          </span>
          <Confidence value={c.confidence} />
        </div>
        <h1 className="text-lg font-semibold leading-relaxed text-pretty whitespace-pre-line">{c.stem}</h1>
      </div>

      {data.tasks.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <Pill tone="warn">{TASK_KIND_LABEL[t.kind] ?? t.kind}</Pill>
              <span>{t.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Ответ" className="lg:col-span-2">
          <div className="flex flex-col gap-4 p-4">
            {c.options.length > 0 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="sr-only">Отметьте правильные варианты</legend>
                {c.options.map((o) => {
                  const on = d.keys.includes(o.key);
                  return (
                    <label
                      key={o.key}
                      className={cx(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                        on ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
                      )}
                    >
                      <input type={multi ? "checkbox" : "radio"} name="correct" checked={on} onChange={() => toggle(o.key)} className="mt-1 accent-emerald-600" />
                      <span className="flex-1 leading-relaxed">{o.text}</span>
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums" title="Голоса доказательств: верно / неверно / выбран">
                        <span className="text-emerald-600 dark:text-emerald-400">+{o.correctVotes}</span>
                        <span className="text-red-500">−{o.incorrectVotes}</span>
                        {o.selectedCount > 0 && <span className="text-slate-400">· выбран {o.selectedCount}</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {textual && (
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Текстовый / числовой ответ
                <input value={d.text} onChange={(e) => setDraft({ ...d, text: e.target.value })} className={selectCls} />
              </label>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
                Тип вопроса
                <select className={selectCls} value={d.type} onChange={(e) => setDraft({ ...d, type: e.target.value })}>
                  {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
                Предмет
                <select className={selectCls} value={d.subject} onChange={(e) => setDraft({ ...d, subject: e.target.value })}>
                  <option value="">Без предмета</option>
                  {SUBJECTS.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(c.reasons.length > 0 || c.conflicts.length > 0) && (
              <ul className="flex flex-col gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                {c.conflicts.map((r, i) => (
                  <li key={`c${i}`} className="text-red-600 dark:text-red-400">
                    ! {r}
                  </li>
                ))}
                {c.reasons.map((r, i) => (
                  <li key={`r${i}`}>• {r}</li>
                ))}
              </ul>
            )}
            {msg && (
              <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
                {msg}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" onClick={() => run("reject")} disabled={!!busy}>
                <X className="h-4 w-4" aria-hidden="true" />
                Отклонить
              </Button>
              <Button onClick={() => run("save")} disabled={!!busy || !draft}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Сохранить
              </Button>
              <Button variant="primary" onClick={() => run("approve")} disabled={!!busy || (!d.keys.length && !d.text.trim())}>
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                Подтвердить и опубликовать
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          title="Независимая проверка"
          action={
            <Button onClick={() => run("verify")} disabled={!!busy || !c.options.length}>
              {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />}
              Проверить ИИ
            </Button>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs leading-relaxed text-slate-500">ИИ-проверка не меняет ответ, а сохраняется как отдельное доказательство. Решение принимает проверяющий.</p>
            {verif.data?.items.length ? (
              <ul className="flex flex-col gap-2">
                {verif.data.items.map((v) => (
                  <li key={v.id} className="flex flex-col gap-1 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Pill tone={v.verdict === "AGREES" ? "ok" : v.verdict === "DISAGREES" ? "bad" : "muted"}>
                        {v.verdict === "AGREES" ? "Согласен" : v.verdict === "DISAGREES" ? "Не согласен" : "Не уверен"}
                      </Pill>
                      <Confidence value={v.confidence} />
                    </div>
                    {!!v.suggestedKeys?.length && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Предлагает: {v.suggestedKeys.map((k) => c.options.find((o) => o.key === k)?.text ?? k).join("; ")}
                      </p>
                    )}
                    {v.notes && <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{v.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Проверок ещё не было.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title={`Экземпляры в документах (${data.instances.length})`}>
        {data.instances.length ? (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.instances.map((q) => (
              <li key={q.id}>
                <InstanceCard q={q} showSource />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Экземпляров нет.</Empty>
        )}
      </Panel>
    </div>
  );
}
