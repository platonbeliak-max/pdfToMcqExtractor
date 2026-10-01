"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { FileUp, Loader2, X } from "lucide-react";
import { Button, Panel, cx, selectCls, sendJson } from "./ui";
import { SUBJECTS } from "@/lib/ingestion/labels";
import type { PageInput } from "@/lib/ingestion/types";

const BATCH_SIZE = 8;
const MAX_BATCH_BYTES = 3_500_000;

type Phase = "idle" | "reading" | "uploading" | "analyzing" | "done" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  reading: "Чтение страниц",
  uploading: "Сохранение страниц",
  analyzing: "Анализ документа",
  done: "Готово",
  error: "Ошибка",
};

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  }
  throw last;
}

export function UploadPanel() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [ocr, setOcr] = useState<"auto" | "force" | "off">("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const busy = phase === "reading" || phase === "uploading" || phase === "analyzing";

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Нужен PDF-файл");
      return;
    }
    setError(null);
    setFile(f);
  };

  async function start() {
    if (!file) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setPhase("reading");
    try {
      const { openPdf, extractPages } = await import("@/lib/ingestion/client-extract");
      const data = await file.arrayBuffer();
      const doc = await openPdf(data.slice(0));
      setProgress({ done: 0, total: doc.numPages });

      const { id } = await sendJson<{ id: string }>("/api/ingest/documents", "POST", {
        filename: file.name,
        fileSize: file.size,
        pageCount: doc.numPages,
        subjectSlug: subject || null,
      });

      // Keep the original PDF for re-processing; failure here never blocks analysis.
      const blobTask = (async () => {
        try {
          const { upload } = await import("@vercel/blob/client");
          const blob = await upload(`documents/${id}/${file.name.replace(/[^\w.\-]+/g, "_")}`, file, {
            access: "private",
            handleUploadUrl: `/api/ingest/documents/${id}/file`,
            contentType: "application/pdf",
          });
          await sendJson(`/api/ingest/documents/${id}/file`, "PATCH", { url: blob.url, pathname: blob.pathname });
        } catch (e) {
          console.warn("Original PDF was not stored:", e);
        }
      })();

      let batch: PageInput[] = [];
      let batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const pages = batch;
        batch = [];
        batchBytes = 0;
        setPhase("uploading");
        await withRetry(() => sendJson(`/api/ingest/documents/${id}/pages`, "PUT", { pages }));
        setPhase("reading");
      };

      for await (const page of extractPages(doc, { ocr, signal: ctrl.signal, ocrLang: "rus+eng" })) {
        const size = JSON.stringify(page).length;
        if (batch.length && (batch.length >= BATCH_SIZE || batchBytes + size > MAX_BATCH_BYTES)) await flush();
        batch.push(page);
        batchBytes += size;
        setProgress({ done: page.pageNumber, total: doc.numPages });
      }
      await flush();
      await doc.cleanup?.();

      setPhase("analyzing");
      await withRetry(() => sendJson(`/api/ingest/documents/${id}/analyze`, "POST"), 2);
      await blobTask;
      setPhase("done");
      mutate("/api/ingest/documents");
      router.push(`/ingest/documents/${id}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Panel title="Новый документ">
      <div className="flex flex-col gap-4 p-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy) pick(e.dataTransfer.files[0]);
          }}
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
            dragOver ? "border-blue-500 bg-blue-500/5" : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <FileUp className="h-6 w-6 text-slate-400" aria-hidden="true" />
          {file ? (
            <span className="text-sm font-medium break-all">{file.name}</span>
          ) : (
            <span className="text-sm text-slate-600 dark:text-slate-400">Перетащите PDF или нажмите, чтобы выбрать</span>
          )}
          <span className="text-xs text-slate-500">Moodle / LMS, банки с +/−, сканы, несколько попыток в одном файле</span>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
            Предмет
            <select className={selectCls} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy}>
              <option value="">Определить автоматически</option>
              {SUBJECTS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
            OCR
            <select className={selectCls} value={ocr} onChange={(e) => setOcr(e.target.value as typeof ocr)} disabled={busy}>
              <option value="auto">Только для страниц без текста</option>
              <option value="force">Для всех страниц</option>
              <option value="off">Отключить</option>
            </select>
          </label>
        </div>

        {phase !== "idle" && phase !== "error" && (
          <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {PHASE_LABEL[phase]}
              </span>
              <span className="tabular-nums">
                {progress.done} / {progress.total} стр.
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className={cx("h-full transition-all", phase === "analyzing" ? "animate-pulse bg-blue-500" : "bg-blue-600")} style={{ width: `${phase === "analyzing" ? 100 : pct}%` }} />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {busy && (
            <Button variant="ghost" onClick={() => abortRef.current?.abort()} disabled={phase === "analyzing"}>
              <X className="h-4 w-4" aria-hidden="true" />
              Отменить
            </Button>
          )}
          <Button variant="primary" onClick={start} disabled={!file || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
            Разобрать документ
          </Button>
        </div>
      </div>
    </Panel>
  );
}
