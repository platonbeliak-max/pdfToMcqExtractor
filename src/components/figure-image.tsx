"use client";

import { useState } from "react";
import useSWR from "swr";
import { ImageOff, RefreshCw } from "lucide-react";
import { getImage } from "@/lib/figure-store";
import { useT } from "@/lib/i18n";
import { isBlankFingerprint } from "@/lib/blank-image";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A data URL never expires, unlike an object URL that a browser may revoke
// when the page is restored from the back/forward cache on phones.
const loadUrl = async ([, id]: [string, string]) => {
  const blob = await getImage(id);
  if (blob) return blobToDataUrl(blob);
  // Built-in banks ship their pictures as static files instead of IndexedDB entries.
  const res = await fetch(`/banks/img/${encodeURIComponent(id)}.webp`);
  return res.ok ? `/banks/img/${encodeURIComponent(id)}.webp` : null;
};

function looksBlank(img: HTMLImageElement): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let fine = "";
  for (let i = 0; i < px.length; i += 4) fine += Math.min(15, Math.floor((px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 16)).toString(16);
  return isBlankFingerprint(fine);
}

export function FigureImage({ imageId, className = "" }: { imageId: string; className?: string }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const [blank, setBlank] = useState(false);
  const {
    data: url,
    isLoading,
    mutate,
  } = useSWR(["figure", imageId], loadUrl, {
    revalidateOnFocus: false,
    errorRetryCount: 2,
    shouldRetryOnError: true,
  });

  const retry = () => {
    setFailed(false);
    void mutate();
  };

  if (isLoading) {
    return <div className={`rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse aspect-[4/3] ${className}`} aria-hidden="true" />;
  }
  if (!url || failed) {
    return (
      <div
        role="status"
        className={`flex items-center gap-3 p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500 ${className}`}
      >
        <ImageOff className="w-4 h-4 shrink-0" />
        <span className="flex-1">{t("figMissing")}</span>
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1 min-h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
        >
          <RefreshCw className="w-4 h-4" />
          {t("figRetry")}
        </button>
      </div>
    );
  }
  if (blank) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local data URL from IndexedDB
    <img
      src={url}
      alt={t("figAlt")}
      decoding="async"
      onLoad={(e) => {
        try {
          if (looksBlank(e.currentTarget)) setBlank(true);
        } catch {}
      }}
      onError={() => setFailed(true)}
      className={`w-full h-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white text-transparent ${className}`}
    />
  );
}
