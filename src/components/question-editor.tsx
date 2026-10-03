"use client";

import React, { useState } from "react";
import { MCQQuestion } from "@/types/question";
import { X, Check, Save, AlertCircle } from "lucide-react";
import { useT } from "@/lib/i18n";

interface QuestionEditorProps {
  question: MCQQuestion;
  isOpen: boolean;
  onSave: (updated: MCQQuestion) => void;
  onClose: () => void;
}

export function QuestionEditor({
  question,
  isOpen,
  onSave,
  onClose,
}: QuestionEditorProps) {
  const { t } = useT();
  const [questionText, setQuestionText] = useState(question.question);
  const [options, setOptions] = useState<Record<string, string>>({
    A: question.options["A"] || "",
    B: question.options["B"] || "",
    C: question.options["C"] || "",
    D: question.options["D"] || "",
    ...(question.options["E"] ? { E: question.options["E"] } : {}),
  });
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(
    question.correctAnswer
  );

  if (!isOpen) return null;

  const handleOptionChange = (key: string, value: string) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddOptionE = () => {
    if (!options["E"]) {
      setOptions((prev) => ({ ...prev, E: "" }));
    }
  };

  const handleRemoveOptionE = () => {
    const updated = { ...options };
    delete updated["E"];
    setOptions(updated);
    if (correctAnswer === "E") {
      setCorrectAnswer(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Re-evaluate confidence
    const optKeys = Object.keys(options).filter((k) => options[k].trim() !== "");
    const hasAnswer = correctAnswer !== null && options[correctAnswer]?.trim() !== "";

    const confidence =
      optKeys.length >= 4 && hasAnswer
        ? "high"
        : optKeys.length >= 3 && hasAnswer
        ? "medium"
        : "needs-review";

    const status = hasAnswer
      ? "answered"
      : optKeys.length >= 2
      ? "missing_answer"
      : "needs_review";

    onSave({
      ...question,
      question: questionText.trim(),
      options,
      correctAnswer,
      answerText: correctAnswer ? options[correctAnswer] : undefined,
      confidence,
      status,
      verificationStatus: "verified",
      isEdited: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in-50">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold text-xs">
              Q{question.number}
            </span>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t("edTitle")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Question Text */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              {t("edQuestion")}
            </label>
            <textarea
              rows={3}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder={t("edQuestionPh")}
            />
          </div>

          {/* Options */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {t("edOptions")}
              </label>
              {!options["E"] ? (
                <button
                  type="button"
                  onClick={handleAddOptionE}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("edAddE")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRemoveOptionE}
                  className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                >
                  {t("edRemoveE")}
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              {Object.keys(options).map((key) => {
                const isSelectedAnswer = correctAnswer === key;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCorrectAnswer(isSelectedAnswer ? null : key)
                      }
                      title={t("edMark", { k: key })}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                        isSelectedAnswer
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      {key}
                    </button>
                    <input
                      type="text"
                      value={options[key]}
                      onChange={(e) => handleOptionChange(key, e.target.value)}
                      placeholder={t("edOptionPh", { k: key })}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all focus:outline-none focus:ring-2 ${
                        isSelectedAnswer
                          ? "border-emerald-500/60 bg-emerald-50/20 dark:bg-emerald-950/20 text-slate-900 dark:text-slate-100 focus:ring-emerald-500"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-blue-500"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              {t("edTip")}
            </p>
          </div>

          {/* Correct Answer Selection Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              {t("edCorrectKey")}
            </label>
            <select
              value={correctAnswer || ""}
              onChange={(e) => setCorrectAnswer(e.target.value || null)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("edNoAnswer")}</option>
              {Object.keys(options).map((key) => (
                <option key={key} value={key}>
                  {t("edOption")} {key} {options[key] ? `: ${options[key].slice(0, 30)}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors"
            >
              {t("edCancel")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs transition-colors"
            >
              <Save className="w-4 h-4" />
              {t("edSave")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
