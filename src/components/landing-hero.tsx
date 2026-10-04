"use client";

import React from "react";
import { UploadCloud, Cpu, ListChecks, Download } from "lucide-react";
import { LangSwitch, useT, type TKey } from "@/lib/i18n";

const STEPS: { icon: typeof UploadCloud; title: TKey; desc: TKey }[] = [
  { icon: UploadCloud, title: "step1T", desc: "step1D" },
  { icon: Cpu, title: "step2T", desc: "step2D" },
  { icon: ListChecks, title: "step3T", desc: "step3D" },
  { icon: Download, title: "step4T", desc: "step4D" },
];

export function LandingHero() {
  const { t } = useT();
  return (
    <div className="space-y-10">
      <div className="text-center max-w-3xl mx-auto space-y-5">
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("chooseLang")}</span>
          <LangSwitch />
        </div>
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-balance text-slate-900 dark:text-white">
          {t("heroTitle1")} <span className="text-blue-600 dark:text-blue-400">{t("heroTitle2")}</span>
        </h1>
        <p className="text-base text-slate-600 dark:text-slate-400 text-pretty leading-relaxed">{t("heroText")}</p>
      </div>

      <section aria-labelledby="guide-title" className="max-w-5xl mx-auto">
        <h2 id="guide-title" className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 text-center">
          {t("guideTitle")}
        </h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <s.icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{t(s.title)}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{t(s.desc)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
