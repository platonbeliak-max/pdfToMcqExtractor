import { UploadPanel } from "@/components/ingest/upload-panel";
import { DocumentList } from "@/components/ingest/document-list";

export default function IngestHome() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Документы</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 text-pretty">
          PDF разбирается по слоям: страницы, попытки, вопросы, варианты, метки и баллы. Ответ сохраняется только с доказательствами, а всё сомнительное попадает в очередь проверки.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <UploadPanel />
        </div>
        <div className="lg:col-span-3">
          <DocumentList />
        </div>
      </div>
    </div>
  );
}
