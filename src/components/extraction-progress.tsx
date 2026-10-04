"use client";

import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { ExtractionProgress, ExtractionStep } from "@/types/question";
import { useT, type TKey } from "@/lib/i18n";

interface ExtractionProgressProps {
  progress: ExtractionProgress;
  totalExtracted?: number;
}

interface StepDefinition {
  id: ExtractionStep;
  label: TKey;
}

const STEPS: StepDefinition[] = [
  { id: "uploading", label: "progUploading" },
  { id: "extracting", label: "progExtracting" },
  { id: "detecting_questions", label: "progQuestions" },
  { id: "detecting_options", label: "progOptions" },
  { id: "detecting_answers", label: "progAnswers" },
  { id: "finalizing", label: "progFinalizing" },
];

export function ExtractionProgressView({
  progress,
  totalExtracted,
}: ExtractionProgressProps) {
  const { t } = useT();
  const currentStepIndex = STEPS.findIndex((s) => s.id === progress.step);

  return (
    <div className="w-full max-w-xl mx-auto p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-xl backdrop-blur-md">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center p-3 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 mb-3 animate-pulse">
          <Sparkles className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {t("progTitle")}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1" aria-live="polite">
          {progress.message || t("progDefault")}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden mb-6">
        <div
          className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.max(5, progress.percent)}%` }}
        />
      </div>

      {/* Steps List */}
      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const isDone =
            progress.step === "completed" ||
            (currentStepIndex !== -1 && idx < currentStepIndex);
          const isCurrent = progress.step === step.id;
          const isPending = !isDone && !isCurrent;

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors ${
                isCurrent
                  ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium"
                  : isDone
                  ? "text-slate-700 dark:text-slate-300"
                  : "text-slate-400 dark:text-slate-600"
              }`}
            >
              <div className="flex items-center gap-3">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700 shrink-0" />
                )}
                <span>{t(step.label)}</span>
              </div>
              <span className="text-xs shrink-0 pl-2">
                {isDone ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {t("progDone")}
                  </span>
                ) : isCurrent ? (
                  <span className="text-blue-600 dark:text-blue-400 animate-pulse">
                    {t("progRunning")}
                  </span>
                ) : (
                  <span>{t("progPending")}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {totalExtracted !== undefined && totalExtracted > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 text-center animate-in zoom-in-95">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-semibold border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t("progExtractedN", { n: totalExtracted })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
