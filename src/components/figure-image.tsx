"use client";

import useSWR from "swr";
import { ImageOff } from "lucide-react";
import { getImage } from "@/lib/figure-store";
import { useT } from "@/lib/i18n";

const loadUrl = async ([, id]: [string, string]) => {
  const blob = await getImage(id);
  return blob ? URL.createObjectURL(blob) : null;
};

export function FigureImage({ imageId, className = "" }: { imageId: string; className?: string }) {
  const { t } = useT();
  const { data: url, isLoading } = useSWR(["figure", imageId], loadUrl, { revalidateOnFocus: false });

  if (isLoading) {
    return <div className={`rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse aspect-[4/3] ${className}`} aria-hidden="true" />;
  }
  if (!url) {
    return (
      <div className={`flex items-center gap-2 p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500 ${className}`}>
        <ImageOff className="w-4 h-4 shrink-0" />
        {t("figMissing")}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local object URL from IndexedDB
    <img
      src={url}
      alt={t("figAlt")}
      className={`w-full h-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white ${className}`}
    />
  );
}
