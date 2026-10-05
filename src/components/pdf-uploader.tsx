"use client";

import React, { useState, useRef, DragEvent } from "react";
import { UploadCloud, FileText, X, AlertCircle, Sparkles, Cpu, ArrowRight, Plus } from "lucide-react";
import { useT } from "@/lib/i18n";

type OcrMode = "auto" | "force" | "none";
type Options = { useAi: boolean; apiKey?: string; useOcr: string };

interface PdfUploaderProps {
  onFilesSelect: (files: File[], options: Options) => void;
  isLoading: boolean;
}

const MAX_SIZE = 150 * 1024 * 1024;
const fileId = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function PdfUploader({ onFilesSelect, isLoading }: PdfUploaderProps) {
  const { t } = useT();
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [useOcr, setUseOcr] = useState<OcrMode>("auto");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) setError(t("errType"));
      else if (file.size === 0) setError(t("errEmpty"));
      else if (file.size > MAX_SIZE) setError(t("errSize"));
      else accepted.push(file);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map(fileId));
      return [...prev, ...accepted.filter((f) => !seen.has(fileId(f)))];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => fileId(f) !== id));
  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1048576;

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
        disabled={isLoading}
      />
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => files.length === 0 && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-5 sm:p-10 text-center transition-all ${
          dragActive
            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
            : "border-slate-300 dark:border-slate-700 hover:border-blue-400 bg-white/70 dark:bg-slate-900/70"
        } ${files.length ? "border-solid border-blue-500/50" : "cursor-pointer"}`}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mb-4">
              <UploadCloud className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 text-balance">{t("dropTitle")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md text-pretty leading-relaxed">{t("dropText")}</p>
            <div className="mt-5 inline-flex items-center gap-2 min-h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              <FileText className="w-4 h-4" />
              {t("browse")}
            </div>
            <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">{t("maxSize")}</div>
          </div>
        ) : (
          <div className="flex flex-col items-stretch gap-3">
            <div className="flex items-center justify-between gap-2 text-left">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t("filesSelected", { n: files.length })}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{totalMb.toFixed(1)} MB</span>
            </div>
            <ul className="flex flex-col gap-2">
              {files.map((f) => (
                <li
                  key={fileId(f)}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate text-sm">{f.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{(f.size / 1048576).toFixed(1)} MB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(fileId(f))}
                    disabled={isLoading}
                    aria-label={`${t("removeFile")}: ${f.name}`}
                    className="flex items-center justify-center w-11 h-11 shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {t("addMoreFiles")}
              </button>
              <button
                type="button"
                onClick={() => onFilesSelect(files, { useAi: false, useOcr })}
                disabled={isLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-11 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {t("extractNow")}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-200 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">{t("uploadError")}</span>
            {error}
          </div>
          <button onClick={() => setError(null)} aria-label="Close" className="text-rose-400 hover:text-rose-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <Cpu className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>{t("ocrHint")}</span>
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <span className="font-medium text-slate-500 dark:text-slate-400">{t("ocrMode")}:</span>
          <select
            value={useOcr}
            onChange={(e) => setUseOcr(e.target.value as OcrMode)}
            className="min-h-11 px-2.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 text-base sm:text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="auto">{t("ocrAuto")}</option>
            <option value="force">{t("ocrForce")}</option>
            <option value="none">{t("ocrNone")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
