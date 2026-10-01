import type { Metadata } from "next";
import { IngestNav } from "@/components/ingest/ingest-nav";

export const metadata: Metadata = {
  title: "Импорт тестов — банк вопросов",
  description: "Универсальный разбор PDF с тестами: попытки, вопросы, варианты, доказательства ответа и единый банк вопросов.",
};

export default function IngestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ru" className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <IngestNav />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
