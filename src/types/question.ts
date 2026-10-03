export type MCQOptionKey = "A" | "B" | "C" | "D" | "E" | "ক" | "খ" | "গ" | "ঘ" | "ঙ" | string;

export type ConfidenceLevel = "high" | "medium" | "needs-review";

export type QuestionVerificationStatus = "pending" | "review" | "verified" | "rejected";

export type QuestionStatus = "answered" | "missing_answer" | "needs_review";

export interface QuestionOptionItem {
  key: string;
  text: string;
}

export interface QuestionAnswerItem {
  key: string;
  text: string;
}

export interface QuestionConfidenceBreakdown {
  question: number; // e.g. 0.98
  options: number;  // e.g. 0.95
  answer: number;   // e.g. 0.99
  overall: number;  // e.g. 0.97
  level: ConfidenceLevel;
}

export interface QuestionSourceInfo {
  documentId: string;
  documentName?: string;
  pageNumber: number;
  sourcePosition?: string;
}

/**
 * Production-ready Structured Question Model conforming to Section 9 of specification.
 */
export interface StructuredQuestion {
  _id: string;
  id: string;
  questionNumber: number;
  question: {
    text: string;
  };
  options: QuestionOptionItem[];
  answer: QuestionAnswerItem | null;
  explanation?: string;
  source: QuestionSourceInfo;
  confidence: QuestionConfidenceBreakdown;
  status: QuestionVerificationStatus;
  category?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  isEdited?: boolean;
  imageId?: string;
  originalQuestion?: {
    text: string;
    options: QuestionOptionItem[];
    answer: QuestionAnswerItem | null;
  };
}

/**
 * Backward-compatible MCQQuestion interface for existing components.
 */
export interface MCQQuestion {
  id: string;
  number: number | string;
  rawNumber?: string;
  question: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  answerText?: string;
  confidence: ConfidenceLevel;
  status: QuestionStatus;
  verificationStatus?: QuestionVerificationStatus;
  pageNumber?: number;
  explanation?: string;
  isEdited?: boolean;
  category?: string;
  tags?: string[];
  /** How many times this unique question was found across attempts/documents. */
  attempts?: number;
  /** Key of a picture saved in the browser image store (labelled-figure questions). */
  imageId?: string;
}

/** Splits a stored answer key ("A,C" / "A, C") into individual option keys. */
export function answerKeys(key: string | null | undefined): string[] {
  if (!key) return [];
  return key.split(/[,;|]/).map((k) => k.trim()).filter(Boolean);
}

export function isCorrectKey(answerKey: string | null | undefined, optionKey: string): boolean {
  return answerKeys(answerKey).includes(optionKey);
}

export interface ExtractionStats {
  totalQuestions: number;
  answeredCount: number;
  unansweredCount: number;
  needsReviewCount: number;
  verifiedCount?: number;
  rejectedCount?: number;
  pendingCount?: number;
  totalPages: number;
  isOcrUsed: boolean;
}

export type ExtractionStep =
  | "idle"
  | "uploading"
  | "analyzing"
  | "detecting_type"
  | "extracting"
  | "ocr"
  | "detecting_questions"
  | "detecting_options"
  | "detecting_answers"
  | "validating"
  | "finalizing"
  | "saving"
  | "completed"
  | "error";

export interface ExtractionProgress {
  step: ExtractionStep;
  message: string;
  percent: number;
  details?: string;
}

export interface ExtractionResponse {
  success: boolean;
  questions: MCQQuestion[];
  stats: ExtractionStats;
  rawText?: string;
  error?: string;
}

export interface DocumentRecord {
  _id: string;
  id: string;
  fileName: string;
  fileUrl?: string;
  fileSize: number;
  pageCount: number;
  pdfType: "text" | "scanned" | "mixed";
  processingStatus: "uploaded" | "processing" | "completed" | "failed";
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionJobRecord {
  _id: string;
  documentId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  currentStep: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Configuration for Programmatic SVG Generation Engine conforming to Section 20.
 */
export interface SVGLayoutConfig {
  width: number;
  height: number;
  padding: number;
  questionSectionWidth: number;
  answerSectionWidth: number;
  questionFontSize: number;
  optionFontSize: number;
  answerFontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: "light" | "dark" | "exam-minimal" | "navy-card" | "emerald-paper";
  showAnswer: boolean;
  showExplanation: boolean;
  showConfidence: boolean;
  showWatermark: boolean;
  watermarkText?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  backgroundColor?: string;
  textColor?: string;
  answerColor?: string;
}

export const DEFAULT_SVG_CONFIG: SVGLayoutConfig = {
  width: 1200,
  height: 650,
  padding: 48,
  questionSectionWidth: 760,
  answerSectionWidth: 340,
  questionFontSize: 28,
  optionFontSize: 22,
  answerFontSize: 26,
  fontFamily: "'Hind Siliguri', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  lineHeight: 1.45,
  theme: "light",
  showAnswer: true,
  showExplanation: false,
  showConfidence: true,
  showWatermark: false,
  watermarkText: "Question Extraction Platform",
  borderWidth: 1.5,
  borderRadius: 24,
};

/**
 * Converts legacy MCQQuestion to StructuredQuestion
 */
export function toStructuredQuestion(
  mcq: MCQQuestion,
  docId: string = "doc-default",
  docName: string = "document.pdf"
): StructuredQuestion {
  const optionsList: QuestionOptionItem[] = Object.entries(mcq.options || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, text]) => ({ key, text }));

  const ansKey = mcq.correctAnswer || "";
  const ansText =
    mcq.answerText ||
    (ansKey
      ? answerKeys(ansKey)
          .map((k) => mcq.options?.[k])
          .filter(Boolean)
          .join("; ")
      : "");

  const optionScore = optionsList.length >= 4 ? 0.98 : optionsList.length >= 3 ? 0.85 : 0.6;
  const hasAnswer = Boolean(ansKey || ansText);
  const answerScore = hasAnswer ? 0.99 : 0.0;
  const questionScore = mcq.question.length > 10 ? 0.99 : 0.8;
  const overall = Number(((questionScore + optionScore + (hasAnswer ? answerScore : 0.5)) / 3).toFixed(2));

  return {
    _id: mcq.id,
    id: mcq.id,
    questionNumber: typeof mcq.number === "number" ? mcq.number : parseInt(String(mcq.number), 10) || 1,
    question: {
      text: mcq.question,
    },
    options: optionsList,
    answer: ansKey || ansText ? { key: ansKey, text: ansText } : null,
    explanation: mcq.explanation,
    source: {
      documentId: docId,
      documentName: docName,
      pageNumber: mcq.pageNumber || 1,
    },
    confidence: {
      question: questionScore,
      options: optionScore,
      answer: answerScore,
      overall,
      level: mcq.confidence,
    },
    status: mcq.verificationStatus || (mcq.confidence === "high" ? "verified" : "pending"),
    category: mcq.category || "General",
    tags: mcq.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEdited: mcq.isEdited,
    imageId: mcq.imageId,
  };
}

/**
 * Converts StructuredQuestion to backward-compatible MCQQuestion
 */
export function toMCQQuestion(sq: StructuredQuestion): MCQQuestion {
  const optionsMap: Record<string, string> = {};
  for (const opt of sq.options) {
    optionsMap[opt.key] = opt.text;
  }

  let status: QuestionStatus = "needs_review";
  if (sq.answer && (sq.answer.key || sq.answer.text)) {
    status = "answered";
  } else {
    status = "missing_answer";
  }

  return {
    id: sq.id || sq._id,
    number: sq.questionNumber,
    rawNumber: String(sq.questionNumber),
    question: sq.question.text,
    options: optionsMap,
    correctAnswer: sq.answer && sq.answer.key ? sq.answer.key : null,
    answerText: sq.answer ? sq.answer.text : undefined,
    confidence: sq.confidence.level,
    status,
    verificationStatus: sq.status,
    pageNumber: sq.source.pageNumber,
    explanation: sq.explanation,
    isEdited: sq.isEdited,
    category: sq.category,
    tags: sq.tags,
    imageId: sq.imageId,
  };
}

export const isFigureQuestion = (q: { tags?: string[]; imageId?: string }) => Boolean(q.imageId) || Boolean(q.tags?.includes("figure"));
