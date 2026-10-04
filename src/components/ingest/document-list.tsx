"use client";

import Link from "next/link";
import useSWR from "swr";
import { FileText } from "lucide-react";
import { Empty, Panel, Pill, fetcher } from "./ui";
import { DOC_STATUS_LABEL, subjectName } from "@/lib/ingestion/labels";

interface DocRow {
  id: string;
  filename: string;
  pageCount: number;
  pagesReceived: number;
  status: string;
  stage: string;
  subjectSlug: string | null;
  summary: { questions?: number; parsed?: number; needsReview?: number; failed?: number; attempts?: number } | null;
  createdAt: string;
  importedAt: string | null;
}

const statusTone = (s: string) =>
  s === "IMPORTED" ? "ok" : s === "ANALYZED" ? "info" : s === "FAILED" ? "bad" : s === "PROCESSING_INCOMPLETE" ? "warn" : "muted";

export function DocumentList() {
  const { data, error, isLoading } = useSWR<{ items: DocRow[] }>("/api/ingest/documents", fetcher, { refreshInterval: 15000 });
  return (
    <Panel title="Документы">
      {error ? (
        <Empty>Не удалось загрузить список: {error.message}</Empty>
      ) : isLoading ? (
        <Empty>Загрузка…</Empty>
      ) : !data?.items.length ? (
        <Empty>Документов пока нет. Загрузите первый PDF.</Empty>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {data.items.map((d) => (
            <li key={d.id}>
              <Link href={`/ingest/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{d.filename}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {d.pageCount} стр.
                    {d.summary?.attempts ? ` · попыток: ${d.summary.attempts}` : ""}
                    {d.summary?.questions != null ? ` · вопросов: ${d.summary.questions}` : ""}
                    {d.subjectSlug ? ` · ${subjectName(d.subjectSlug)}` : ""}
                    {" · "}
                    {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                  </span>
                </div>
                {!!d.summary?.needsReview && <Pill tone="warn">проверить: {d.summary.needsReview}</Pill>}
                {!!d.summary?.failed && <Pill tone="bad">ошибок: {d.summary.failed}</Pill>}
                <Pill tone={statusTone(d.status)}>{DOC_STATUS_LABEL[d.status] ?? d.status}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
