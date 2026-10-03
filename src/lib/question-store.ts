import {
  StructuredQuestion,
  MCQQuestion,
  DocumentRecord,
  QuestionVerificationStatus,
  toStructuredQuestion,
  toMCQQuestion,
} from "@/types/question";
import {
  detectDuplicateQuestions,
  exportToStandardCSV,
  downloadCsvFile,
} from "./csv-manager";
import { downloadBulkSvgZip } from "./svg/svg-generator";
import { stripScoreNoise } from "./ingestion/noise";
import { clearImages, deleteImages } from "./figure-store";

const STORAGE_QUESTIONS_KEY = "mcq_platform_questions_v2";
const STORAGE_DOCS_KEY = "mcq_platform_documents_v2";

export interface QuestionBankFilter {
  searchQuery?: string;
  status?: "all" | "approved" | "pending" | "review" | "rejected" | "duplicate";
  confidence?: "all" | "high" | "medium" | "needs-review";
  documentId?: "all" | string;
  category?: "all" | string;
  page?: number;
  pageSize?: number;
  sortBy?: "number" | "confidence" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface QuestionBankStats {
  totalPdfs: number;
  totalQuestions: number;
  approvedCount: number;
  pendingCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  duplicateCount: number;
  categoriesCount: number;
}

/**
 * Loads questions from persistent storage (localStorage / API).
 */
export function loadSavedQuestions(): StructuredQuestion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_QUESTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const sq =
          "options" in item && Array.isArray(item.options)
            ? (item as StructuredQuestion)
            : toStructuredQuestion(item as MCQQuestion);
        return cleanStoredQuestion(sq);
      });
    }
  } catch (e) {
    console.warn("Failed to load questions from storage:", e);
  }
  return [];
}

/** Banks saved before score stripping existed still contain "Балл: 1,00" in their text. */
function cleanStoredQuestion(sq: StructuredQuestion): StructuredQuestion {
  return {
    ...sq,
    question: { ...sq.question, text: stripScoreNoise(sq.question.text) },
    options: sq.options.map((o) => ({ ...o, text: stripScoreNoise(o.text) })),
    answer: sq.answer ? { ...sq.answer, text: stripScoreNoise(sq.answer.text || "") } : sq.answer,
  };
}

/** Removes a document and every question extracted from it. */
export function deleteDocumentWithQuestions(
  doc: DocumentRecord,
  questions: StructuredQuestion[]
): { documents: DocumentRecord[]; questions: StructuredQuestion[] } {
  const documents = loadSavedDocuments().filter((d) => d.id !== doc.id);
  const remaining = questions.filter(
    (q) => q.source?.documentId !== doc.id && q.source?.documentName !== doc.fileName
  );
  persistDocuments(documents);
  persistQuestions(remaining);
  const kept = new Set(remaining.map((q) => q.imageId).filter(Boolean));
  void deleteImages(
    questions.map((q) => q.imageId).filter((id): id is string => Boolean(id) && !kept.has(id))
  );
  return { documents, questions: remaining };
}

/** Wipes the whole bank: documents, questions and the current extraction session. */
export function clearAllStorage(sessionKey: string): void {
  if (typeof window === "undefined") return;
  void clearImages();
  localStorage.removeItem(STORAGE_QUESTIONS_KEY);
  localStorage.removeItem(STORAGE_DOCS_KEY);
  localStorage.removeItem(sessionKey);
}

/**
 * Saves questions to persistent storage.
 */
export function persistQuestions(questions: StructuredQuestion[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_QUESTIONS_KEY, JSON.stringify(questions));
  } catch (e) {
    console.warn("Failed to persist questions to storage:", e);
  }
}

/**
 * Loads documents list from storage.
 */
export function loadSavedDocuments(): DocumentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_DOCS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DocumentRecord[];
  } catch (e) {
    console.warn("Failed to load documents from storage:", e);
  }
  return [];
}

/**
 * Saves documents list to storage.
 */
export function persistDocuments(documents: DocumentRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_DOCS_KEY, JSON.stringify(documents));
  } catch (e) {
    console.warn("Failed to persist documents to storage:", e);
  }
}

/**
 * Registers or updates a document record.
 */
export function registerDocument(
  fileName: string,
  fileSize: number,
  pageCount: number,
  questionCount: number,
  pdfType: "text" | "scanned" | "mixed" = "text"
): DocumentRecord {
  const docs = loadSavedDocuments();
  const id = `doc-${Date.now()}`;
  const newDoc: DocumentRecord = {
    _id: id,
    id,
    fileName,
    fileSize,
    pageCount,
    questionCount,
    pdfType,
    processingStatus: "completed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updatedDocs = [newDoc, ...docs.filter((d) => d.fileName !== fileName)];
  persistDocuments(updatedDocs);
  return newDoc;
}

/**
 * Filters and paginates questions in the Question Bank.
 */
export function queryQuestionBank(
  questions: StructuredQuestion[],
  filter: QuestionBankFilter
): {
  items: StructuredQuestion[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  duplicateMap: Map<string, string[]>;
} {
  const duplicateMap = detectDuplicateQuestions(questions);

  let filtered = [...questions];

  // 1. Search filter
  if (filter.searchQuery && filter.searchQuery.trim()) {
    const q = filter.searchQuery.toLowerCase().trim();
    filtered = filtered.filter((item) => {
      const qText = item.question.text.toLowerCase();
      const optMatch = item.options.some((o) => o.text.toLowerCase().includes(q));
      const ansMatch = item.answer?.text.toLowerCase().includes(q) || item.answer?.key.toLowerCase() === q;
      const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q));
      const categoryMatch = item.category?.toLowerCase().includes(q);
      const docMatch = item.source?.documentName?.toLowerCase().includes(q);
      return qText.includes(q) || optMatch || ansMatch || tagMatch || categoryMatch || docMatch;
    });
  }

  // 2. Status filter
  if (filter.status && filter.status !== "all") {
    if (filter.status === "duplicate") {
      filtered = filtered.filter((item) => duplicateMap.has(item.id));
    } else if (filter.status === "approved") {
      filtered = filtered.filter((item) => item.status === "verified");
    } else if (filter.status === "review") {
      filtered = filtered.filter((item) => !item.answer);
    } else {
      filtered = filtered.filter((item) => item.status === filter.status);
    }
  }

  // 3. Confidence filter
  if (filter.confidence && filter.confidence !== "all") {
    filtered = filtered.filter((item) => item.confidence.level === filter.confidence);
  }

  // 4. Document filter
  if (filter.documentId && filter.documentId !== "all") {
    filtered = filtered.filter((item) => item.source.documentId === filter.documentId);
  }

  // 5. Category filter
  if (filter.category && filter.category !== "all") {
    filtered = filtered.filter((item) => item.category === filter.category);
  }

  // 6. Sorting
  const sortBy = filter.sortBy || "number";
  const order = filter.sortOrder || "asc";
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "number") {
      cmp = a.questionNumber - b.questionNumber;
    } else if (sortBy === "confidence") {
      cmp = a.confidence.overall - b.confidence.overall;
    } else if (sortBy === "updatedAt") {
      cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    }
    return order === "asc" ? cmp : -cmp;
  });

  // 7. Pagination
  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.max(5, filter.pageSize || 20);
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    duplicateMap,
  };
}

/**
 * Computes platform-wide statistics for the Dashboard.
 */
export function computeQuestionBankStats(
  questions: StructuredQuestion[],
  documents: DocumentRecord[]
): QuestionBankStats {
  const duplicateMap = detectDuplicateQuestions(questions);
  const categories = new Set<string>();

  let approvedCount = 0;
  let pendingCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;

  questions.forEach((q) => {
    if (q.category) categories.add(q.category);
    if (q.status === "verified") approvedCount++;
    else if (q.status === "pending") pendingCount++;
    else if (q.status === "review" || q.confidence.level === "needs-review") needsReviewCount++;
    else if (q.status === "rejected") rejectedCount++;
  });

  return {
    totalPdfs: documents.length,
    totalQuestions: questions.length,
    approvedCount,
    pendingCount,
    needsReviewCount,
    rejectedCount,
    duplicateCount: duplicateMap.size,
    categoriesCount: categories.size,
  };
}
