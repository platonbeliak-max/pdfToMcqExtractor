"use client";

import React, { useState, useMemo } from "react";
import {
  StructuredQuestion,
  MCQQuestion,
  toStructuredQuestion,
  toMCQQuestion,
} from "@/types/question";
import {
  queryQuestionBank,
  QuestionBankFilter,
  persistQuestions,
} from "@/lib/question-store";
import {
  exportToStandardCSV,
  downloadCsvFile,
  detectDuplicateQuestions,
} from "@/lib/csv-manager";
import { downloadBulkSvgZip } from "@/lib/svg/svg-generator";
import {
  Search,
  Filter,
  CheckCircle2,
  Trash2,
  Download,
  FileSpreadsheet,
  Sparkles,
  Plus,
  AlertTriangle,
  HelpCircle,
  Eye,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Edit2,
  Copy,
} from "lucide-react";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n";
import { isCorrectKey, answerKeys } from "@/types/question";
import { SvgEditorModal } from "./svg-editor-modal";
import { ManualQuestionModal } from "./manual-question-modal";
import { CsvImportModal } from "./csv-import-modal";
import { QuestionEditor } from "./question-editor";

interface QuestionBankViewProps {
  questions: StructuredQuestion[];
  onUpdateQuestions: (updated: StructuredQuestion[]) => void;
  onViewSource?: (page: number) => void;
}

export function QuestionBankView({
  questions,
  onUpdateQuestions,
  onViewSource,
}: QuestionBankViewProps) {
  const { showToast } = useToast();
  const { t } = useT();

  const [filter, setFilter] = useState<QuestionBankFilter>({
    searchQuery: "",
    status: "all",
    confidence: "all",
    page: 1,
    pageSize: 20,
    sortBy: "number",
    sortOrder: "asc",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals state
  const [svgTargetQuestion, setSvgTargetQuestion] = useState<StructuredQuestion | null>(null);
  const [editTargetQuestion, setEditTargetQuestion] = useState<MCQQuestion | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);

  // Query and filter data
  const { items, total, page, pageSize, totalPages, duplicateMap } = useMemo(() => {
    return queryQuestionBank(questions, filter);
  }, [questions, filter]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allCurrent = new Set(items.map((i) => i.id));
      setSelectedIds(allCurrent);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string) => {
    const updated = new Set(selectedIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedIds(updated);
  };

  const handleApproveSingle = (id: string) => {
    const updated = questions.map((q) =>
      q.id === id ? { ...q, status: "verified" as const, updatedAt: new Date().toISOString() } : q
    );
    onUpdateQuestions(updated);
    persistQuestions(updated);
    showToast("Question Approved", "Question marked as verified in Question Bank", "success");
  };

  const handleDeleteSingle = (id: string) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    const updated = questions.filter((q) => q.id !== id);
    onUpdateQuestions(updated);
    persistQuestions(updated);
    showToast("Question Deleted", "Question removed from Question Bank", "info");
  };

  const handleBulkApprove = () => {
    if (selectedIds.size === 0) return;
    const updated = questions.map((q) =>
      selectedIds.has(q.id)
        ? { ...q, status: "verified" as const, updatedAt: new Date().toISOString() }
        : q
    );
    onUpdateQuestions(updated);
    persistQuestions(updated);
    showToast("Bulk Approved", `Approved ${selectedIds.size} questions`, "success");
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected questions?`)) return;
    const updated = questions.filter((q) => !selectedIds.has(q.id));
    onUpdateQuestions(updated);
    persistQuestions(updated);
    showToast("Bulk Deleted", `Removed ${selectedIds.size} questions`, "info");
    setSelectedIds(new Set());
  };

  const handleExportSelectedCsv = () => {
    const target =
      selectedIds.size > 0
        ? questions.filter((q) => selectedIds.has(q.id))
        : questions;
    const csvContent = exportToStandardCSV(target);
    downloadCsvFile(csvContent, `question-bank-${Date.now()}.csv`);
    showToast("CSV Exported", `Exported ${target.length} questions conforming to Section 46`, "success");
  };

  const handleExportSelectedSvgZip = async () => {
    const target =
      selectedIds.size > 0
        ? questions.filter((q) => selectedIds.has(q.id))
        : questions;
    await downloadBulkSvgZip(target);
    showToast("Bulk SVG Export", `Generated ZIP bundle with ${target.length} SVG files`, "success");
  };

  const handleSaveEditedQuestion = (updatedMCQ: MCQQuestion) => {
    const updatedSQ = toStructuredQuestion(updatedMCQ);
    const updated = questions.map((q) => (q.id === updatedSQ.id ? updatedSQ : q));
    onUpdateQuestions(updated);
    persistQuestions(updated);
    setEditTargetQuestion(null);
    showToast("Question Updated", "Changes saved to Question Bank", "success");
  };

  const handleAddManual = (newSQ: StructuredQuestion) => {
    const updated = [newSQ, ...questions];
    onUpdateQuestions(updated);
    persistQuestions(updated);
  };

  const handleCsvImported = (imported: StructuredQuestion[]) => {
    const updated = [...imported, ...questions];
    onUpdateQuestions(updated);
    persistQuestions(updated);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar: Search, Filters & Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filter.searchQuery || ""}
            onChange={(e) => setFilter({ ...filter, searchQuery: e.target.value, page: 1 })}
            placeholder={t("searchBank")}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsManualModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addQuestion")}
          </button>
          <button
            onClick={() => setIsCsvImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            {t("importCsv")}
          </button>
          <button
            onClick={handleExportSelectedCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            {t("exportCsv")}
          </button>
          <button
            onClick={handleExportSelectedSvgZip}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Bulk SVG (ZIP)
          </button>
        </div>
      </div>

      {/* Filter Tabs & Bulk Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          {[
            { id: "all", label: `${t("all")} (${questions.length})` },
            { id: "approved", label: t("approved") },
            { id: "pending", label: t("pending") },
            { id: "review", label: `${t("noAnswer")} (${questions.filter((q) => !q.answer).length})` },
            { id: "duplicate", label: `${t("duplicates")} (${duplicateMap.size})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter({ ...filter, status: tab.id as any, page: 1 })}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                filter.status === tab.id
                  ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Bulk Action Controls */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50">
            <span className="font-bold text-blue-700 dark:text-blue-300 text-xs">
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleBulkApprove}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors"
            >
              <CheckCircle2 className="w-3 h-3" />
              Approve
            </button>
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Questions List / Cards */}
      {items.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <HelpCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
            {t("noQuestions")}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            {t("noQuestionsText")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((q) => {
            const isSelected = selectedIds.has(q.id);
            const isDuplicate = duplicateMap.has(q.id);
            const confPercent = Math.round(q.confidence.overall * 100);

            return (
              <div
                key={q.id}
                className={`p-4 rounded-2xl border transition-all duration-200 bg-white dark:bg-slate-900 ${
                  isSelected
                    ? "border-blue-500 ring-2 ring-blue-500/20 shadow-xs"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs"
                }`}
              >
                {/* Header row: Checkbox, Question Number, Badges, Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(q.id)}
                      className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-extrabold text-xs px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      #{String(q.questionNumber).padStart(3, "0")}
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        q.status === "verified"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : q.status === "rejected"
                          ? "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                          : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      {q.status === "verified" ? t("approved") : q.status === "rejected" ? "×" : t("pending")}
                    </span>

                    {/* Confidence Score */}
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                      {confPercent}%
                    </span>

                    {/* Duplicate Warning */}
                    {isDuplicate && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        Duplicate
                      </span>
                    )}

                    {/* Source page info */}
                    {q.source?.pageNumber && (
                      <button
                        type="button"
                        onClick={() => onViewSource?.(q.source.pageNumber)}
                        className="text-[10px] text-blue-600 dark:text-blue-400 font-medium hover:underline"
                      >
                        Page {q.source.pageNumber}
                      </button>
                    )}
                  </div>

                  {/* Right Action Icons */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSvgTargetQuestion(q)}
                      title="Open in SVG Studio"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 text-[11px] font-bold transition-colors"
                    >
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      SVG
                    </button>
                    {q.status !== "verified" && (
                      <button
                        type="button"
                        onClick={() => handleApproveSingle(q.id)}
                        title="Approve Question"
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditTargetQuestion(toMCQQuestion(q))}
                      title="Edit Question"
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSingle(q.id)}
                      title="Delete Question"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Question Text */}
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2 leading-relaxed">
                  {q.question.text}
                </h4>

                {/* Options Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                  {q.options.map((opt) => {
                    const isCorrect = isCorrectKey(q.answer?.key, opt.key);
                    return (
                      <div
                        key={opt.key}
                        className={`flex items-start gap-2 p-2 rounded-xl border text-xs ${
                          isCorrect
                            ? "border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-100 font-semibold"
                            : "border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center font-bold text-[10px] shrink-0 ${
                            isCorrect
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {opt.key}
                        </span>
                        <span className="flex-1 truncate">{opt.text}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Answer Strip */}
                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{t("answer")}: </span>
                    {q.answer ? (
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {answerKeys(q.answer.key).join(", ")}
                        {q.answer.key && q.answer.text ? ". " : ""}
                        {q.answer.text}
                      </span>
                    ) : (
                      <span className="italic font-semibold text-rose-500">{t("notDetected")}</span>
                    )}
                  </div>
                  {q.category && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {q.category}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800 text-xs">
          <span className="text-slate-500">
            Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total} questions
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setFilter({ ...filter, page: page - 1 })}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 font-bold">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setFilter({ ...filter, page: page + 1 })}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* SVG Studio Modal */}
      {svgTargetQuestion && (
        <SvgEditorModal
          isOpen={Boolean(svgTargetQuestion)}
          question={svgTargetQuestion}
          onClose={() => setSvgTargetQuestion(null)}
        />
      )}

      {/* Question Editor Modal */}
      {editTargetQuestion && (
        <QuestionEditor
          isOpen={Boolean(editTargetQuestion)}
          question={editTargetQuestion}
          onSave={handleSaveEditedQuestion}
          onClose={() => setEditTargetQuestion(null)}
        />
      )}

      {/* Manual Creation Modal */}
      <ManualQuestionModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSave={handleAddManual}
        nextNumber={questions.length + 1}
      />

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isCsvImportOpen}
        onClose={() => setIsCsvImportOpen(false)}
        onImportComplete={handleCsvImported}
      />
    </div>
  );
}
