"use client";

import { ExtractionStats } from "@/types/question";
import { useT } from "@/lib/i18n";
import { CheckCircle, AlertTriangle, HelpCircle, FileText, Layers, Sparkles } from "lucide-react";

interface StatsCardProps {
  stats: ExtractionStats;
}

export function StatsCard({ stats }: StatsCardProps) {
  const { t } = useT();
  const cards = [
    {
      label: t("stTotal"),
      value: stats.totalQuestions,
      icon: Layers,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
    },
    {
      label: t("stFound"),
      value: stats.answeredCount,
      icon: CheckCircle,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
    },
    {
      label: t("stMissing"),
      value: stats.unansweredCount,
      icon: HelpCircle,
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
    },
    {
      label: t("stReview"),
      value: stats.needsReviewCount,
      icon: AlertTriangle,
      color: "text-rose-600 dark:text-rose-400",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/20",
    },
    {
      label: t("stPages"),
      value: stats.totalPages,
      icon: FileText,
      color: "text-indigo-600 dark:text-indigo-400",
      bgColor: "bg-indigo-500/10",
      borderColor: "border-indigo-500/20",
      badge: stats.isOcrUsed ? t("stOcr") : t("stText"),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 w-full">
      {cards.map((c, idx) => {
        const Icon = c.icon;
        return (
          <div
            key={idx}
            className={`p-4 rounded-xl border bg-white dark:bg-slate-900 shadow-xs transition-all hover:shadow-md ${c.borderColor}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {c.label}
              </span>
              <div className={`p-2 rounded-lg ${c.bgColor}`}>
                <Icon className={`w-4 h-4 ${c.color}`} />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                {c.value}
              </div>
              {c.badge && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {c.badge}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
