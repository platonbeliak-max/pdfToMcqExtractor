"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { AnswerStatusPill, Button, Empty, Panel, Pill, Stat, cx, fetcher, selectCls, sendJson } from "./ui";
import { InstanceCard } from "./instance-card";
import { DOC_STATUS_LABEL, SOURCE_TYPE_LABEL, SUBJECTS, subjectName } from "@/lib/ingestion/labels";
import type { CoverageAudit, DocumentProfile, QuestionInstance, TestAttempt } from "@/lib/ingestion/types";

interface Detail {
  document: {
    id: string;
    filename: string;
    pageCount: number;
    pagesReceived: number;
    status: string;
    stage: string;
    subjectSlug: string | null;
    subjectSource: string | null;
    blobPathname: string | null;
    engineVersion: string | null;
    profile: DocumentProfile | null;
    audit: CoverageAudit | null;
    summary: Record<string, number> | null;
    error: string | null;
    importedAt: string | null;
  };
  attempts: TestAttempt[];
  instances: (QuestionInstance & { canonicalId: string | null })[];
  errors: { id: number; page: number | null; stage: string; severity: string; code: string; message: string }[];
}

type Filter = "all" | "review" | "failed" | "noanswer";

export function DocumentDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<Detail>(`/api/ingest/documents/${id}`, fetcher);
  const [busy, setBusy] = useState<null | "import" | "analyze" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [attemptFilter, setAttemptFilter] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");

  const instances = useMemo(() => {
    if (!data) return [];
    return data.instances.filter((q) => {
      if (attemptFilter !== "all" && q.attemptId !== attemptFilter) return false;
      if (filter === "review") return q.extractionStatus === "NEEDS_REVIEW" || q.answer.status === "NEEDS_REVIEW" || q.answer.status === "CONFLICT";
      if (filter === "failed") return q.extractionStatus === "FAILED";
      if (filter === "noanswer") return q.answer.status === "UNRESOLVED";
      return true;
    });
  }, [data, attemptFilter, filter]);

  if (error) return <Empty>Ошибка: {error.message}</Empty>;
  if (isLoading || !data) return <Empty>Загрузка…</Empty>;

  const { document: doc, attempts, audit, profile } = { ...data, audit: data.document.audit, profile: data.document.profile };
  const effectiveSubject = subject ?? doc.subjectSlug ?? "";

  async function act(kind: "import" | "analyze" | "delete") {
    setActionError(null);
    if (kind === "delete" && !confirm("Удалить документ и все его экземпляры вопросов? Канонические вопросы, подтверждённые другими документами, сохранятся.")) return;
    setBusy(kind);
    try {
      if (kind === "import") await sendJson(`/api/ingest/documents/${id}/import`, "POST", { subjectSlug: effectiveSubject || null });
      if (kind === "analyze") await sendJson(`/api/ingest/documents/${id}/analyze`, "POST");
      if (kind === "delete") {
        await sendJson(`/api/ingest/documents/${id}`, "DELETE");
        router.push("/ingest");
        return;
      }
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const s = doc.summary ?? {};
  const answered = data.instances.filter((q) => q.answer.correctOptionIds.length || q.answer.textAnswer || q.answer.correctOrder || q.answer.matching).length;
  const statusCounts = data.instances.reduce<Record<string, number>>((m, q) => ((m[q.answer.status] = (m[q.answer.status] ?? 0) + 1), m), {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/ingest" className="text-xs text-slate-500 hover:underline">
            ← Документы
          </Link>
          <h1 className="text-xl font-semibold tracking-tight break-all">{doc.filename}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill tone={doc.status === "IMPORTED" ? "ok" : doc.status === "FAILED" ? "bad" : doc.status === "PROCESSING_INCOMPLETE" ? "warn" : "info"}>{DOC_STATUS_LABEL[doc.status] ?? doc.status}</Pill>
            {profile && <span>{SOURCE_TYPE_LABEL[profile.sourceType] ?? profile.sourceType}</span>}
            <span>· {doc.pageCount} стр.</span>
            {doc.engineVersion && <span>· {doc.engineVersion}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc.blobPathname && (
            <a href={`/api/ingest/documents/${id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <Download className="h-4 w-4" aria-hidden="true" />
              Оригинал
            </a>
          )}
          <Button onClick={() => act("analyze")} disabled={!!busy} title="Повторно прогнать движок по сохранённым страницам">
            {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Переанализировать
          </Button>
          <Button variant="danger" onClick={() => act("delete")} disabled={!!busy}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Удалить</span>
          </Button>
        </div>
      </div>

      {(doc.error || actionError) && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {actionError ?? doc.error}
        </p>
      )}

      {doc.pagesReceived < doc.pageCount && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Получено {doc.pagesReceived} из {doc.pageCount} страниц. Загрузка была прервана — загрузите файл заново.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Попыток" value={attempts.length} />
        <Stat label="Вопросов найдено" value={data.instances.length} />
        <Stat label="Разобрано" value={s.parsed ?? data.instances.filter((q) => q.extractionStatus === "PARSED").length} tone="ok" />
        <Stat label="На проверку" value={s.needsReview ?? data.instances.filter((q) => q.extractionStatus === "NEEDS_REVIEW").length} tone="warn" />
        <Stat label="Не разобрано" value={s.failed ?? data.instances.filter((q) => q.extractionStatus === "FAILED").length} tone="bad" />
        <Stat label="С ответом" value={answered} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Импорт в банк" className="lg:col-span-1">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusCounts).map(([st, n]) => (
                <span key={st} className="flex items-center gap-1">
                  <AnswerStatusPill status={st} />
                  <span className="text-xs tabular-nums text-slate-500">{n}</span>
                </span>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Предмет {doc.subjectSource === "AUTO" && profile?.detectedSubject && <span>(определён автоматически, {Math.round(profile.detectedSubject.confidence * 100)}%)</span>}
              <select className={selectCls} value={effectiveSubject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Без предмета</option>
                {SUBJECTS.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs leading-relaxed text-slate-500">
              Импорт объединяет повторы между попытками и документами. Вопросы с конфликтом или без ответа создаются, но попадают в очередь проверки и не публикуются в банк.
            </p>
            <Button variant="primary" onClick={() => act("import")} disabled={!!busy || !data.instances.length}>
              {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {doc.importedAt ? "Импортировать заново" : "Импортировать"}
            </Button>
            {doc.importedAt && (
              <p className="text-xs text-slate-500">
                Импортирован {new Date(doc.importedAt).toLocaleString("ru-RU")} · {subjectName(doc.subjectSlug)}
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Аудит полноты" className="lg:col-span-2" action={audit && <Pill tone={audit.status === "COMPLETE" ? "ok" : "warn"}>{audit.status === "COMPLETE" ? "Полный" : "Неполный"}</Pill>}>
          {audit ? (
            <div className="flex flex-col gap-3 p-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                {[
                  ["Страниц обработано", `${audit.processedPages} / ${audit.totalPages}`],
                  ["Пустых страниц", audit.emptyPages.length],
                  ["Нечитаемых", audit.unreadablePages.length],
                  ["Строк", audit.totalLines],
                  ["Шум (колонтитулы и т.п.)", audit.noiseLines],
                  ["Строк без вопроса", audit.orphanLines],
                  ["Баллов привязано", `${audit.scoreBlocksAttached} / ${audit.scoreBlocks}`],
                  ["Меток привязано", `${audit.marksAttached} / ${audit.marks}`],
                  ["Изображений привязано", `${audit.imagesAttached} / ${audit.images}`],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex items-baseline justify-between gap-2 border-b border-dashed border-slate-200 py-1 dark:border-slate-800">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {audit.problems.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-amber-800 dark:text-amber-300">
                  {audit.problems.map((p) => (
                    <li key={p} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Empty>Анализ ещё не выполнен.</Empty>
          )}
        </Panel>
      </div>

      {attempts.length > 0 && (
        <Panel title="Попытки">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Название</th>
                  <th className="px-4 py-2 font-medium">Страницы</th>
                  <th className="px-4 py-2 font-medium">Вопросов</th>
                  <th className="px-4 py-2 font-medium">Баллы</th>
                  <th className="px-4 py-2 font-medium">Состояние</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                    <td className="px-4 py-2 tabular-nums">{a.ordinal}</td>
                    <td className="max-w-xs truncate px-4 py-2">{a.title ?? "—"}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {a.startPage}–{a.endPage}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{a.questionCount}</td>
                    <td className="px-4 py-2 tabular-nums">{a.scoreEarned != null ? `${a.scoreEarned}${a.scoreMax != null ? ` / ${a.scoreMax}` : ""}` : "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{a.state ?? a.grade ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title={`Вопросы (${instances.length})`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {attempts.length > 1 && (
              <select aria-label="Попытка" className={selectCls} value={attemptFilter} onChange={(e) => setAttemptFilter(e.target.value)}>
                <option value="all">Все попытки</option>
                {attempts.map((a) => (
                  <option key={a.id} value={a.id}>
                    Попытка {a.ordinal}
                  </option>
                ))}
              </select>
            )}
            <div role="tablist" aria-label="Фильтр" className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {(
                [
                  ["all", "Все"],
                  ["review", "Проверить"],
                  ["noanswer", "Без ответа"],
                  ["failed", "Ошибки"],
                ] as [Filter, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={cx("rounded-md px-2 py-1 text-xs font-medium", filter === k ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 dark:text-slate-400")}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {instances.length ? (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {instances.map((q) => (
              <li key={q.id}>
                <InstanceCard q={q} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Нет вопросов под этот фильтр.</Empty>
        )}
      </Panel>

      {data.errors.length > 0 && (
        <Panel title={`Журнал обработки (${data.errors.length})`}>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800/60">
            {data.errors.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-2">
                <Pill tone={e.severity === "ERROR" ? "bad" : "warn"}>{e.stage}</Pill>
                <span className="w-14 shrink-0 text-xs text-slate-500 tabular-nums">{e.page ? `стр. ${e.page}` : ""}</span>
                <span className="text-slate-700 dark:text-slate-300">{e.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
