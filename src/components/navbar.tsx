"use client";

import React from "react";
import { ThemeToggle } from "./theme-toggle";
import { LangSwitch, useT } from "@/lib/i18n";
import {
  FileText,
  LayoutDashboard,
  UploadCloud,
  BookOpen,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react";

export type PlatformTab = "dashboard" | "upload" | "bank" | "test" | "svg-studio";

interface NavbarProps {
  activeTab: PlatformTab;
  onSelectTab: (tab: PlatformTab) => void;
  questionCount?: number;
  hasExtractedData?: boolean;
  onReset?: () => void;
}

export function Navbar({
  activeTab,
  onSelectTab,
  questionCount = 0,
  hasExtractedData,
  onReset,
}: NavbarProps) {
  const { t } = useT();
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 sm:py-0 sm:h-16 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2">
        {/* Brand */}
        <div
          onClick={() => onSelectTab("dashboard")}
          className="flex items-center gap-3 cursor-pointer shrink-0"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div className="hidden lg:block">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-slate-100">
                {t("brand")}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 hidden md:block">
              {t("brandSub")}
            </p>
          </div>
        </div>

        {/* Center Navigation Tabs conforming to Section 12 */}
        <nav aria-label="Main" className="order-last sm:order-none w-full sm:w-auto flex items-center justify-between sm:justify-start gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 text-xs font-bold">
          <button
            onClick={() => onSelectTab("dashboard")}
            className={`flex items-center gap-1.5 flex-1 sm:flex-none justify-center min-h-9 px-2.5 lg:px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
              activeTab === "dashboard"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("navDashboard")}</span>
          </button>

          <button
            onClick={() => onSelectTab("upload")}
            className={`flex items-center gap-1.5 flex-1 sm:flex-none justify-center min-h-9 px-2.5 lg:px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
              activeTab === "upload"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>{t("navExtract")}</span>
          </button>

          <button
            onClick={() => onSelectTab("bank")}
            className={`flex items-center gap-1.5 flex-1 sm:flex-none justify-center min-h-9 px-2.5 lg:px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
              activeTab === "bank"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("navBank")}</span>
            <span className="sm:hidden">{t("navBankShort")}</span>
            {questionCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-extrabold">
                {questionCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab("test")}
            className={`flex items-center gap-1.5 flex-1 sm:flex-none justify-center min-h-9 px-2.5 lg:px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
              activeTab === "test"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>{t("navTest")}</span>
          </button>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-2 ml-auto sm:ml-0">
          {hasExtractedData && onReset && (
            <button
              onClick={onReset}
              title={t("newPdf")}
              aria-label={t("newPdf")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t("newPdf")}</span>
            </button>
          )}

          <LangSwitch />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
