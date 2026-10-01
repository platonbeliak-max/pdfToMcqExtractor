"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Database, FileStack, ListChecks } from "lucide-react";
import { cx, fetcher } from "./ui";

const LINKS = [
  { href: "/ingest", label: "Документы", icon: FileStack, match: (p: string) => p === "/ingest" || p.startsWith("/ingest/documents") },
  { href: "/ingest/bank", label: "Банк вопросов", icon: Database, match: (p: string) => p.startsWith("/ingest/bank") || p.startsWith("/ingest/questions") },
  { href: "/ingest/review", label: "Проверка", icon: ListChecks, match: (p: string) => p.startsWith("/ingest/review") },
];

export function IngestNav() {
  const pathname = usePathname();
  const { data } = useSWR<{ counts: Record<string, number> }>("/api/ingest/review?limit=1", fetcher, { refreshInterval: 30000 });
  const openTasks = data ? Object.values(data.counts).reduce((s, n) => s + n, 0) : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Старый режим</span>
        </Link>
        <span className="h-5 w-px bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
        <span className="font-semibold tracking-tight">Импорт тестов</span>
        <nav aria-label="Разделы импорта" className="ml-auto flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
                {href === "/ingest/review" && openTasks > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white tabular-nums">{openTasks}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
