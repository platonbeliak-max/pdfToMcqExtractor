"use client";

import React, { useState, useRef, useEffect } from "react";
import { MCQQuestion } from "@/types/question";
import {
  Download,
  Copy,
  FileCode,
  FileSpreadsheet,
  FileText,
  File,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  formatAllQuestionsText,
  exportToJSON,
  exportToCSV,
  exportToExcel,
  exportToWord,
} from "@/lib/export";
import { useToast } from "./toast";
import confetti from "canvas-confetti";
import { useT } from "@/lib/i18n";

interface ExportMenuProps {
  questions: MCQQuestion[];
  filename?: string;
}

export function ExportMenu({ questions, filename = "mcq-bank" }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const { t } = useT();

  const baseName = filename.replace(/\.[^/.]+$/, "");

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const triggerDownload = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Subtle celebratory confetti
    confetti({
      particleCount: 25,
      spread: 60,
      origin: { y: 0.85 },
      colors: ["#3B82F6", "#10B981", "#6366F1"],
    });
  };

  const handleCopyAll = () => {
    const text = formatAllQuestionsText(questions);
    navigator.clipboard.writeText(text);
    showToast(t("expCopiedT"), t("expCopiedD", { n: questions.length }), "success");
    setIsOpen(false);
  };

  const handleDownloadTxt = () => {
    const text = formatAllQuestionsText(questions);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, "txt");
    showToast(t("expTxtT"), t("expTxtD", { n: questions.length }), "success");
    setIsOpen(false);
  };

  const handleDownloadJSON = () => {
    const jsonStr = exportToJSON(questions);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    triggerDownload(blob, "json");
    showToast(t("expJsonT"), t("expJsonD"), "success");
    setIsOpen(false);
  };

  const handleDownloadCSV = () => {
    const csvStr = exportToCSV(questions);
    const blob = new Blob([csvStr], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, "csv");
    showToast(t("expCsvT"), t("expCsvD"), "success");
    setIsOpen(false);
  };

  const handleDownloadExcel = () => {
    try {
      const buffer = exportToExcel(questions);
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      triggerDownload(blob, "xlsx");
      showToast(t("expXlsxT"), t("expXlsxD"), "success");
    } catch (err) {
      showToast(t("expXlsxErr"), String(err), "error");
    }
    setIsOpen(false);
  };

  const handleDownloadWord = async () => {
    try {
      setIsExporting(true);
      const blob = await exportToWord(questions);
      triggerDownload(blob, "docx");
      showToast(t("expDocxT"), t("expDocxD"), "success");
    } catch (err) {
      showToast(t("expDocxErr"), String(err), "error");
    } finally {
      setIsExporting(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        disabled={questions.length === 0 || isExporting}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition-colors"
      >
        <Download className="w-4 h-4" />
        <span>{t("expTitle")}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-30 py-2 divide-y divide-slate-100 dark:divide-slate-800 animate-in fade-in-50 zoom-in-95">
          {/* Quick Copy */}
          <div className="py-1">
            <button
              onClick={handleCopyAll}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Copy className="w-4 h-4 text-blue-500" />
              <div className="text-left">
                <div className="font-semibold">{t("expCopy")}</div>
                <div className="text-[10px] text-slate-400">{t("expCopySub")}</div>
              </div>
            </button>
          </div>

          {/* Formats */}
          <div className="py-1">
            <button
              onClick={handleDownloadExcel}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <div className="text-left">
                <div className="font-semibold">{t("expXlsx")}</div>
                <div className="text-[10px] text-slate-400">{t("expXlsxSub")}</div>
              </div>
            </button>

            <button
              onClick={handleDownloadWord}
              disabled={isExporting}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <div className="text-left">
                <div className="font-semibold">{t("expDocx")}</div>
                <div className="text-[10px] text-slate-400">{t("expDocxSub")}</div>
              </div>
            </button>

            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <File className="w-4 h-4 text-emerald-600" />
              <div className="text-left">
                <div className="font-semibold">{t("expCsv")}</div>
                <div className="text-[10px] text-slate-400">{t("expCsvSub")}</div>
              </div>
            </button>

            <button
              onClick={async () => {
                setIsOpen(false);
                try {
                  const { downloadBulkSvgZip } = await import("@/lib/svg/svg-generator");
                  await downloadBulkSvgZip(questions);
                  showToast(t("expSvgT"), t("expSvgD", { n: questions.length }), "success");
                } catch (e) {
                  showToast(t("expSvgErr"), String(e), "error");
                }
              }}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <FileCode className="w-4 h-4 text-amber-500" />
              <div className="text-left">
                <div className="font-semibold">{t("expSvg")}</div>
                <div className="text-[10px] text-slate-400">{t("expSvgSub")}</div>
              </div>
            </button>

            <button
              onClick={handleDownloadJSON}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <FileCode className="w-4 h-4 text-purple-600" />
              <div className="text-left">
                <div className="font-semibold">{t("expJson")}</div>
                <div className="text-[10px] text-slate-400">{t("expJsonSub")}</div>
              </div>
            </button>

            <button
              onClick={handleDownloadTxt}
              className="flex items-center gap-3 w-full px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <FileText className="w-4 h-4 text-slate-500" />
              <div className="text-left">
                <div className="font-semibold">{t("expTxt")}</div>
                <div className="text-[10px] text-slate-400">{t("expTxtSub")}</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
