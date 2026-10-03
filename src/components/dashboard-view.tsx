"use client";

import React from "react";
import { StructuredQuestion, DocumentRecord, answerKeys } from "@/types/question";
import { exportToStandardCSV, downloadCsvFile } from "@/lib/csv-manager";
import { useT, type TKey } from "@/lib/i18n";
import { FileText, HelpCircle, CheckCircle2, AlertTriangle, UploadCloud, Download, ArrowRight, BookOpen } from "lucide-react";
import { useToast } from "./toast";

interface DashboardViewProps {
  questions: StructuredQuestion[];
  documents: DocumentRecord[];
  onNavigateTab: (tab: "dashboard" | "upload" | "bank" | "svg-studio") => void;
}

function hasAnswer(q: StructuredQuestion) {
  if (q.options.length) return answerKeys(q.answer?.key).some((k) => q.options.some((o) => o.key === k));
  return !!(q.answer?.text || "").trim();
}

export function DashboardView({ questions, documents, onNavigateTab }: DashboardViewProps) {
  const { showToast } = useToast();
  const { t } = useT();
  const answered = questions.filter(hasAnswer).length;

  const handleExportCsv = () => {
    if (questions.length === 0) {
      showToast(t("dEmptyToast"), t("dEmptyToastD"), "info");
      return;
    }
    downloadCsvFile(exportToStandardCSV(questions), "question-bank.csv");
    showToast(t("dCsv"), t("dCsvDone", { n: questions.length }), "success");
  };

  const stats: { label: TKey; sub: TKey; value: number; icon: React.ElementType; tone: string }[] = [
    { label: "dPdfs", sub: "dPdfsSub", value: documents.length, icon: FileText, tone: "text-slate-900 dark:text-slate-100" },
    { label: "dTotal", sub: "dTotalSub", value: questions.length, icon: HelpCircle, tone: "text-slate-900 dark:text-slate-100" },
    { label: "dAnswered", sub: "dAnsweredSub", value: answered, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "dMissing", sub: "dMissingSub", value: questions.length - answered, icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="p-6 sm:p-8 rounded-3xl bg-blue-600 text-white">
        <div className="max-w-2xl flex flex-col gap-2">
          <span className="self-start px-3 py-1 rounded-full bg-white/20 text-xs font-bold">{t("dBadge")}</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-balance">{t("dTitle")}</h2>
          <p className="text-sm text-blue-100 leading-relaxed text-pretty">{t("dText")}</p>
          <div className="pt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigateTab("upload")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-blue-700 hover:bg-blue-50 font-bold text-sm"
            >
              <UploadCloud className="w-4 h-4" aria-hidden="true" />
              {t("dUpload")}
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("bank")}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-semibold text-sm"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              {t("dBrowse")}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, sub, value, icon: Icon, tone }) => (
          <div key={label} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-1">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="text-xs font-bold">{t(label)}</span>
              <Icon className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className={`text-3xl font-black ${tone}`}>{value}</div>
            <span className="text-xs text-slate-500 dark:text-slate-400">{t(sub)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("dDocs")}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("dDocsSub")}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("upload")}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              {t("dUpload")}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("dNoDocs")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="pb-2 font-semibold">{t("dColDoc")}</th>
                    <th className="pb-2 font-semibold">{t("dColPages")}</th>
                    <th className="pb-2 font-semibold">{t("dColQ")}</th>
                    <th className="pb-2 font-semibold">{t("dColStatus")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {documents.slice(0, 10).map((doc) => (
                    <tr key={doc.id}>
                      <td className="py-3 font-semibold text-slate-800 dark:text-slate-200 max-w-56 truncate">{doc.fileName}</td>
                      <td className="py-3 text-slate-500 dark:text-slate-400">{doc.pageCount}</td>
                      <td className="py-3 font-bold text-blue-600 dark:text-blue-400">{doc.questionCount}</td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          {t("dReady")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lg:col-span-4 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("dExport")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t("dExportText")}</p>
          <button
            type="button"
            onClick={handleExportCsv}
            className="mt-1 w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-800 dark:text-slate-200 text-sm font-bold"
          >
            <span className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                <Download className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="text-left flex flex-col">
                {t("dCsv")}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t("dCsvSub")}</span>
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </button>
        </section>
      </div>
    </div>
  );
}
