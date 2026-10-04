"use client";

import React, { useState, useRef, DragEvent } from "react";
import { UploadCloud, FileText, X, AlertCircle, Sparkles, Cpu, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

type OcrMode = "auto" | "force" | "none";
type Options = { useAi: boolean; apiKey?: string; useOcr: string };

interface PdfUploaderProps {
  onFileSelect: (file: File, options: Options) => void;
  isLoading: boolean;
}

export function PdfUploader({ onFileSelect, isLoading }: PdfUploaderProps) {
  const { t } = useT();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useOcr, setUseOcr] = useState<OcrMode>("auto");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = (file: File) => {
    setError(null);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return setError(t("errType"));
    if (file.size === 0) return setError(t("errEmpty"));
    if (file.size > 150 * 1024 * 1024) return setError(t("errSize"));
    setSelectedFile(file);
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
    if (e.dataTransfer.files?.[0]) validateAndSetFile(e.dataTransfer.files[0]);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !selectedFile && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer ${
          dragActive
            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
            : "border-slate-300 dark:border-slate-700 hover:border-blue-400 bg-white/70 dark:bg-slate-900/70"
        } ${selectedFile ? "cursor-default border-solid border-blue-500/50" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && validateAndSetFile(e.target.files[0])}
          disabled={isLoading}
        />

        {!selectedFile ? (
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mb-4">
              <UploadCloud className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("dropTitle")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">{t("dropText")}</p>
            <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              <FileText className="w-4 h-4" />
              {t("browse")}
            </div>
            <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">{t("maxSize")}</div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-full max-w-md">
              <div className="p-3 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <FileText className="w-6 h-6" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate text-sm">{selectedFile.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{(selectedFile.size / 1048576).toFixed(1)} MB</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
                disabled={isLoading}
                aria-label={t("removeFile")}
                title={t("removeFile")}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileSelect(selectedFile, { useAi: false, useOcr });
              }}
              disabled={isLoading}
              className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {t("extractNow")}
              <ArrowRight className="w-4 h-4" />
            </button>
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
            className="px-2.5 py-1 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
