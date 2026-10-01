"use client";

import type { ReactNode } from "react";
import { ANSWER_STATUS_LABEL, ANSWER_STATUS_TONE } from "@/lib/ingestion/labels";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

export async function sendJson<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

type Tone = "ok" | "warn" | "bad" | "muted" | "info";

const TONE: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/25",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/25",
  muted: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/25",
};

export function Pill({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}

export function AnswerStatusPill({ status }: { status: string }) {
  return <Pill tone={ANSWER_STATUS_TONE[status] ?? "muted"}>{ANSWER_STATUS_LABEL[status] ?? status}</Pill>;
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums" title={`Уверенность ${pct}%`}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden="true">
        <span className={cx("block h-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const v = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-600/50",
    secondary: "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800",
    danger: "border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10",
    ghost: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
  }[variant];
  return (
    <button
      type="button"
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60", v, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className={cx("text-lg font-semibold tabular-nums", tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100")}>
        {value}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export const selectCls =
  "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40";
