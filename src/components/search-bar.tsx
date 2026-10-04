"use client";

import React from "react";
import { Search, X, Filter } from "lucide-react";
import { useT } from "@/lib/i18n";

export type FilterOption =
  | "all"
  | "answered"
  | "missing_answer"
  | "needs_review"
  | "high_confidence";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: FilterOption;
  onFilterChange: (filter: FilterOption) => void;
  counts: {
    all: number;
    answered: number;
    missing_answer: number;
    needs_review: number;
    high_confidence: number;
  };
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  counts,
}: SearchBarProps) {
  const { t } = useT();
  const filterPills: { id: FilterOption; label: string; count: number }[] = [
    { id: "all", label: t("fAll"), count: counts.all },
    { id: "answered", label: t("fAnswered"), count: counts.answered },
    { id: "missing_answer", label: t("fMissing"), count: counts.missing_answer },
    { id: "needs_review", label: t("fReview"), count: counts.needs_review },
    { id: "high_confidence", label: t("fHigh"), count: counts.high_confidence },
  ];

  return (
    <div className="space-y-3 w-full">
      {/* Search Input Box */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPh")}
          className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {filterPills.map((pill) => {
          const isActive = activeFilter === pill.id;
          return (
            <button
              key={pill.id}
              onClick={() => onFilterChange(pill.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
              }`}
            >
              <span>{pill.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isActive
                    ? "bg-white/25 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {pill.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
