"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { GitMerge, X } from "lucide-react";
import { AnswerStatusPill, Button, Empty, Panel, Pill, cx, fetcher, sendJson } from "./ui";
import { TASK_KIND_LABEL } from "@/lib/ingestion/labels";

interface Item {
  task: { id: number; kind: string; reason: string; canonicalId: string | null; documentId: string; resolution: { candidateCanonicalId?: string } | null; createdAt: string };
  stem: string | null;
  answerStatus: string | null;
  filename: string | null;
}

export function ReviewQueue() {
  const [kind, setKind] = useState("");
  const key = `/api/ingest/review?limit=200${kind ? `&kind=${kind}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<{ items: Item[]; counts: Record<string, number> }>(key, fetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const [busy, setBusy] = useState<number | null>(null);
  const total = data ? Object.values(data.counts).reduce((s, n) => s + n, 0) : 0;

  async function act(taskId: number, action: "dismiss" | "merge") {
    setBusy(taskId);
    try {
      await sendJson("/api/ingest/review", "POST", { taskId, action });
      await mutate();
      globalMutate("/api/ingest/review?limit=1");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Очередь проверки</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Конфликты, вопросы без ответа, сомнительный разбор и возможные дубликаты. Ничего не публикуется в банк без доказательств или ручного подтверждения.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Тип задачи">
        {[["", `Все (${total})`] as const, ...Object.entries(data?.counts ?? {}).map(([k, n]) => [k, `${TASK_KIND_LABEL[k] ?? k} (${n})`] as const)].map(([k, l]) => (
          <button
            key={k || "all"}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              kind === k ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "border border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <Panel>
        {error ? (
          <Empty>Ошибка: {error.message}</Empty>
        ) : isLoading ? (
          <Empty>Загрузка…</Empty>
        ) : !data?.items.length ? (
          <Empty>Очередь пуста.</Empty>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.items.map(({ task, stem, answerStatus, filename }) => (
              <li key={task.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Pill tone={task.kind === "ANSWER_CONFLICT" || task.kind === "EXTRACTION_FAILED" ? "bad" : "warn"}>{TASK_KIND_LABEL[task.kind] ?? task.kind}</Pill>
                    {answerStatus && <AnswerStatusPill status={answerStatus} />}
                    {filename && (
                      <Link href={`/ingest/documents/${task.documentId}`} className="max-w-[16rem] truncate hover:underline">
                        {filename}
                      </Link>
                    )}
                  </div>
                  {stem && <p className="line-clamp-2 text-sm text-slate-900 dark:text-slate-100">{stem}</p>}
                  <p className="text-xs text-slate-500">{task.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {task.kind === "POSSIBLE_DUPLICATE" && task.resolution?.candidateCanonicalId && (
                    <>
                      <Link href={`/ingest/questions/${task.resolution.candidateCanonicalId}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                        Похожий
                      </Link>
                      <Button onClick={() => act(task.id, "merge")} disabled={busy === task.id}>
                        <GitMerge className="h-4 w-4" aria-hidden="true" />
                        Объединить
                      </Button>
                    </>
                  )}
                  {task.canonicalId && (
                    <Link href={`/ingest/questions/${task.canonicalId}`} className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                      Открыть
                    </Link>
                  )}
                  <Button variant="ghost" onClick={() => act(task.id, "dismiss")} disabled={busy === task.id} aria-label="Отклонить задачу">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
