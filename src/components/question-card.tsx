"use client";

import React from "react";
import { MCQQuestion, answerKeys, isCorrectKey } from "@/types/question";
import { useT } from "@/lib/i18n";
import {
  Copy,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileQuestion,
  Check,
  Sparkles,
} from "lucide-react";
import { formatSingleQuestionText } from "@/lib/export";
import { useToast } from "./toast";

interface QuestionCardProps {
  question: MCQQuestion;
  isSelected?: boolean;
  onSelect?: (q: MCQQuestion) => void;
  onEdit: (q: MCQQuestion) => void;
  onDelete: (id: string) => void;
  onOpenSvg?: (q: MCQQuestion) => void;
}

export function QuestionCard({
  question,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onOpenSvg,
}: QuestionCardProps) {
  const { showToast } = useToast();
  const { t } = useT();
  const correctKeys = answerKeys(question.correctAnswer);

  const handleCopy = (text: string, title: string) => {
    navigator.clipboard.writeText(text);
    showToast(title, undefined, "success");
  };

  const copyQuestionTextOnly = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleCopy(`${question.number}. ${question.question}`, "Copied Question!");
  };

  const copyOptionsOnly = (e: React.MouseEvent) => {
    e.stopPropagation();
    const opts = Object.entries(question.options || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}. ${v}`)
      .join("\n");
    handleCopy(opts || "No options available", "Copied Options!");
  };

  const copyAnswerOnly = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (correctKeys.length || question.answerText) {
      const val = correctKeys.length
        ? correctKeys.map((k) => `${k}. ${question.options[k] ?? ""}`).join("\n")
        : question.answerText || "";
      handleCopy(val, "OK");
    } else {
      showToast("No answer detected to copy", undefined, "info");
    }
  };

  const copyFullMCQ = (e: React.MouseEvent) => {
    e.stopPropagation();
    const full = formatSingleQuestionText(question);
    handleCopy(full, "Copied Full Question!");
  };

  const options = question.options || {};
  const optionKeys = Object.keys(options).sort();

  // Confidence styling
  const confidenceConfig = {
    high: {
      label: "OK",
      className:
        "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
      icon: CheckCircle2,
    },
    medium: {
      label: "~",
      className:
        "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-500/20",
      icon: AlertTriangle,
    },
    "needs-review": {
      label: "?",
      className:
        "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-500/20",
      icon: HelpCircle,
    },
  }[question.confidence];

  const ConfIcon = confidenceConfig.icon;

  return (
    <div
      onClick={() => onSelect?.(question)}
      className={`relative p-5 rounded-2xl border transition-all duration-200 cursor-pointer ${
        isSelected
          ? "border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/10 dark:bg-blue-950/20 shadow-md"
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs hover:shadow-xs"
      }`}
    >
      {/* Top Header: Question number & badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs">
            {t("question")} {String(question.number).padStart(2, "0")}
          </span>
          {question.pageNumber && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
              {t("page")} {question.pageNumber}
            </span>
          )}
          {question.attempts && question.attempts > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
              {t("foundTimes")} ×{question.attempts}
            </span>
          )}
          {question.status === "missing_answer" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold">
              {t("needAnswer")}
            </span>
          )}
          {question.tags?.includes("unreadable") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold">
              {t("unreadable")}
            </span>
          )}
          {question.isEdited && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium">
              Edited
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${confidenceConfig.className}`}
          >
            <ConfIcon className="w-3 h-3" />
            {confidenceConfig.label}
          </span>
        </div>
      </div>

      {/* Question Text */}
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3.5 leading-relaxed select-text">
        {question.question}
      </div>

      {/* Options Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {optionKeys.map((key) => {
          const isCorrect = isCorrectKey(question.correctAnswer, key);
          return (
            <div
              key={key}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs transition-colors select-text ${
                isCorrect
                  ? "border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 font-medium shadow-2xs"
                  : "border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[11px] shrink-0 ${
                  isCorrect
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {key}
              </span>
              <span className="flex-1 mt-0.5 break-words">{options[key]}</span>
              {isCorrect && (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              )}
            </div>
          );
        })}
      </div>

      {/* Answer Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 dark:text-slate-400">
            {correctKeys.length > 1 ? t("correctAnswers") : t("correctAnswer")}:
          </span>
          {correctKeys.length > 0 ? (
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {correctKeys.join(", ")}
              <span className="font-normal text-slate-700 dark:text-slate-300">
                {" — "}
                {correctKeys.map((k) => options[k] || "").join("; ")}
              </span>
            </span>
          ) : question.answerText ? (
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{question.answerText}</span>
          ) : (
            <span className="italic text-rose-500 font-semibold">{t("needAnswerLong")}</span>
          )}
        </div>

        {/* Action and Copy Buttons */}
        <div className="flex items-center gap-1">
          {/* Copy Dropdown / Buttons */}
          <button
            type="button"
            onClick={copyQuestionTextOnly}
            title="Copy question text only"
            className="px-2 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium transition-colors"
          >
            {t("copyQ")}
          </button>
          <button
            type="button"
            onClick={copyOptionsOnly}
            title="Copy options only"
            className="px-2 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium transition-colors"
          >
            {t("copyOpt")}
          </button>
          <button
            type="button"
            onClick={copyAnswerOnly}
            title="Copy correct answer only"
            className="px-2 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium transition-colors"
          >
            {t("copyAns")}
          </button>
          <button
            type="button"
            onClick={copyFullMCQ}
            title="Copy full MCQ (Question + Options + Answer)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-semibold transition-colors"
          >
            <Copy className="w-3 h-3" />
            {t("copyFull")}
          </button>

          {/* SVG Studio */}
          {onOpenSvg && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSvg(question);
              }}
              title="Open in SVG Studio"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 text-[11px] font-bold transition-colors ml-1"
            >
              <Sparkles className="w-3 h-3 text-amber-500" />
              SVG
            </button>
          )}

          {/* Edit */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(question);
            }}
            title="Edit question"
            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors ml-1"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete Question ${question.number}?`)) {
                onDelete(question.id);
              }
            }}
            title="Delete question"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
