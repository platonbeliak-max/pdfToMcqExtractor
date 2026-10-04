"use client";

import { Loader2, Database } from "lucide-react";
import { useT } from "@/lib/i18n";
import { BUILT_IN_BANKS, type BaseId } from "@/lib/built-in-banks";

interface BaseSwitcherProps {
  active: BaseId;
  onChange: (id: BaseId) => void;
  counts: Record<BaseId, number | null>;
  showMine: boolean;
}

export function BaseSwitcher({ active, onChange, counts, showMine }: BaseSwitcherProps) {
  const { t } = useT();
  const items: { id: BaseId; label: string }[] = [
    ...BUILT_IN_BANKS.map((b) => ({ id: b.id as BaseId, label: t(b.label) })),
    ...(showMine ? [{ id: "mine" as BaseId, label: t("baseMine") }] : []),
  ];

  return (
    <div className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
          <Database className="w-3.5 h-3.5" aria-hidden="true" />
          {t("baseLabel")}
        </span>
        <div role="radiogroup" aria-label={t("baseLabel")} className="flex flex-wrap gap-1.5">
          {items.map((it) => {
            const selected = active === it.id;
            const n = counts[it.id];
            return (
              <button
                key={it.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(it.id)}
                className={`inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-xl text-sm font-bold border transition-colors ${
                  selected
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500"
                }`}
              >
                {it.label}
                {n === null ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label={t("testSourceLoading")} />
                ) : (
                  <span
                    className={`px-1.5 rounded-full text-[11px] font-extrabold ${
                      selected ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
