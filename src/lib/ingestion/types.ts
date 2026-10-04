/**
 * Universal ingestion engine — domain model.
 *
 * Every stage of the pipeline consumes the output of the previous stage and
 * returns a new structure; nothing is mutated in place and raw data is always
 * carried forward so it can be persisted and re-processed later.
 */

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Stage 0 — raw page input (produced by the client: text layer / OCR) */
/* ------------------------------------------------------------------ */

export type TextSource = "TEXT_LAYER" | "OCR";

export interface RawTextItem {
  str: string;
  /** Top-left origin, page units (PDF points at scale 1). */
  x: number;
  y: number;
  w: number;
  h: number;
  font?: string;
  /** OCR word confidence 0..1 (only for OCR items). */
  conf?: number;
}

export interface RawImageRegion {
  bbox: BBox;
}

/** A mark the reader added on top of the PDF (stamp, typed note, freehand drawing). */
export interface PageAnnotation {
  kind: "STAMP" | "FREETEXT" | "INK" | "SQUARE" | "OTHER";
  bbox: BBox;
  text: string;
}

export interface PageInput {
  pageNumber: number;
  annotations?: PageAnnotation[];
  width: number;
  height: number;
  source: TextSource;
  items: RawTextItem[];
  images: RawImageRegion[];
  /** Mean OCR confidence 0..1 when source = OCR. */
  ocrConfidence?: number;
  /** Characters in the PDF text layer (even if OCR was used afterwards). */
  textLayerChars: number;
  /** Non-fatal problems found while reading the page in the browser. */
  readErrors?: string[];
}

/* ------------------------------------------------------------------ */
/* Stage 1 — layout                                                   */
/* ------------------------------------------------------------------ */

export interface LayoutLine {
  /** Stable id: p{page}-l{index}. */
  id: string;
  page: number;
  index: number;
  text: string;
  bbox: BBox;
  source: TextSource;
  conf: number;
  /** Cells when the line is made of x-separated columns (tables). */
  cells: { text: string; bbox: BBox }[];
}

export type LineRole =
  | "ATTEMPT_META"
  | "QUESTION_HEADER"
  | "STATUS"
  | "SCORE"
  | "FLAG"
  | "INSTRUCTION"
  | "OPTION"
  | "MARK_ONLY"
  | "FEEDBACK"
  | "NOISE"
  | "TEXT";

export interface ClassifiedLine extends LayoutLine {
  role: LineRole;
  /** Role-specific parsed payload. */
  meta?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Stage 2 — document profile                                         */
/* ------------------------------------------------------------------ */

export type SourceType =
  | "MOODLE_EXPORT"
  | "LMS_EXPORT"
  | "PLUS_MINUS_BANK"
  | "NUMBERED_LIST"
  | "SCANNED"
  | "UNKNOWN";

export interface DocumentProfile {
  sourceType: SourceType;
  sourceTypeConfidence: number;
  pageCount: number;
  hasTextLayer: boolean;
  textLayerPages: number;
  ocrPages: number;
  emptyPages: number;
  hasImages: boolean;
  hasScores: boolean;
  hasExplicitMarks: boolean;
  hasPlusMinusMarks: boolean;
  hasMultipleAttempts: boolean;
  hasTables: boolean;
  hasFormulas: boolean;
  languages: string[];
  questionTypes: QuestionType[];
  detectedSubject: { slug: string; name: string; confidence: number } | null;
  signals: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Stage 3 — attempts, questions, options, marks, evidence            */
/* ------------------------------------------------------------------ */

export type QuestionType =
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "ORDERING"
  | "MATCHING"
  | "SHORT_TEXT"
  | "NUMERIC"
  | "FORMULA"
  | "IMAGE_LABELING"
  | "IMAGE_IDENTIFICATION"
  | "TABLE"
  | "COMBINATION"
  | "UNKNOWN";

export type ExtractionStatus = "PARSED" | "NEEDS_REVIEW" | "FAILED";

export type ScoreKind = "FULL_SCORE" | "ZERO_SCORE" | "PARTIAL_SCORE" | "UNANSWERED" | "UNKNOWN";

export type GradeStatus = "CORRECT" | "INCORRECT" | "PARTIAL" | "UNANSWERED" | "UNKNOWN";

export type MarkType =
  | "CHECKMARK"
  | "CROSS"
  | "PLUS"
  | "MINUS"
  | "SELECTED"
  | "UNKNOWN_GLYPH"
  | "HANDWRITTEN_CHECK"
  | "HANDWRITTEN_CROSS"
  | "CIRCLED"
  | "UNDERLINED";

export type EvidenceType =
  | "EXPLICIT_CHECKMARK"
  | "EXPLICIT_CROSS"
  | "PLUS_MARK"
  | "MINUS_MARK"
  | "EXPLICIT_TEXT_MARK"
  | "FEEDBACK_TEXT"
  | "STUDENT_RESPONSE"
  | "FULL_SCORE"
  | "ZERO_SCORE"
  | "PARTIAL_SCORE"
  | "ATTEMPT_COMPARISON"
  | "REPEATED_QUESTION"
  | "MEDICAL_SOURCE"
  | "MANUAL_REVIEW"
  | "VISION"
  | "OCR"
  | "UNKNOWN";

export type EvidenceSource = "DOCUMENT" | "SCORE" | "AGGREGATION" | "VISION" | "AI_VERIFICATION" | "USER";

export interface Evidence {
  id: string;
  type: EvidenceType;
  source: EvidenceSource;
  /** Option this evidence is about (null = whole question). */
  optionId: string | null;
  /** true = supports "correct", false = supports "incorrect", null = neutral/context. */
  polarity: boolean | null;
  confidence: number;
  page: number;
  bbox: BBox | null;
  rawValue: string;
}

export interface VisualMark {
  id: string;
  type: MarkType;
  rawGlyph: string;
  page: number;
  bbox: BBox | null;
  associatedOptionId: string | null;
  confidence: number;
  source: "TEXT_LAYER" | "OCR" | "VISION";
}

export interface AnswerOption {
  id: string;
  /** Visual label as printed (a, B, 1, ...) — never used for identity. */
  label: string | null;
  position: number;
  rawText: string;
  text: string;
  normalizedText: string;
  page: number;
  bbox: BBox | null;
  /** For MATCHING: right-hand side; for ORDERING: printed order index. */
  pairText?: string | null;
  orderIndex?: number | null;
}

export interface ScoreInfo {
  earned: number | null;
  max: number | null;
  kind: ScoreKind;
  grade: GradeStatus;
  raw: string;
  page: number;
  bbox: BBox | null;
}

export interface TableAsset {
  id: string;
  page: number;
  bbox: BBox;
  rows: { cells: { text: string; bbox: BBox }[] }[];
}

export interface FormulaAsset {
  id: string;
  page: number;
  bbox: BBox | null;
  raw: string;
  latex: string | null;
  confidence: number;
  source: TextSource;
}

export interface ImageAsset {
  id: string;
  page: number;
  bbox: BBox;
  /** Numeric label referenced by the stem ("цифрой 17"), if any. */
  referencedLabel: string | null;
}

export type AnswerStatus =
  | "CONFIRMED_BY_DOCUMENT"
  | "CONFIRMED_BY_SCORE"
  | "CONFIRMED_BY_MULTIPLE_ATTEMPTS"
  | "MEDICALLY_VERIFIED"
  | "MANUALLY_CONFIRMED"
  | "CONFLICT"
  | "NEEDS_REVIEW"
  | "UNRESOLVED";

export interface InstanceAnswer {
  correctOptionIds: string[];
  incorrectOptionIds: string[];
  /** Options selected by the student in that attempt (if detectable). */
  selectedOptionIds: string[];
  /** For ORDERING: option ids in correct order. For MATCHING: optionId → pairText. */
  correctOrder: string[] | null;
  matching: Record<string, string> | null;
  /** Free-text / numeric answer printed in feedback. */
  textAnswer: string | null;
  /** True when the correct set is known to be complete (not just partial). */
  complete: boolean;
  status: AnswerStatus;
  confidence: number;
  reasons: string[];
}

export interface QuestionInstance {
  id: string;
  /** Text typed into an LMS answer field (short-answer questions). */
  studentResponse?: string | null;
  inlineCorrectAnswer?: string | null;
  documentId: string;
  attemptId: string;
  /** Physical PDF page where the block starts (1-based). */
  physicalPage: number;
  pages: number[];
  /** Page index within the attempt (1-based). */
  internalPage: number;
  /** Printed number (NOT an identity). */
  questionNumber: number | null;
  /** Ordinal within the document (identity is `id`). */
  sequence: number;
  rawText: string;
  stem: string;
  normalizedStem: string;
  instruction: string | null;
  questionType: QuestionType;
  questionTypeConfidence: number;
  questionTypeSignals: string[];
  options: AnswerOption[];
  score: ScoreInfo | null;
  visualMarks: VisualMark[];
  evidence: Evidence[];
  images: ImageAsset[];
  tables: TableAsset[];
  formulas: FormulaAsset[];
  feedback: string | null;
  answer: InstanceAnswer;
  bbox: BBox | null;
  lineIds: string[];
  confidence: number;
  extractionStatus: ExtractionStatus;
  issues: string[];
  subjectHints: string[];
}

export interface TestAttempt {
  id: string;
  documentId: string;
  ordinal: number;
  title: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  state: string | null;
  scoreEarned: number | null;
  scoreMax: number | null;
  grade: string | null;
  startPage: number;
  endPage: number;
  questionCount: number;
  boundaryReason: string;
}

export interface ProcessingIssue {
  stage: string;
  page: number | null;
  severity: "WARNING" | "ERROR";
  code: string;
  message: string;
  lineIds?: string[];
}

export interface CoverageAudit {
  totalPages: number;
  processedPages: number;
  emptyPages: number[];
  unreadablePages: number[];
  totalLines: number;
  classifiedLines: number;
  noiseLines: number;
  assignedLines: number;
  orphanLines: number;
  totalDetected: number;
  totalParsed: number;
  totalNeedsReview: number;
  totalFailed: number;
  balanced: boolean;
  scoreBlocks: number;
  scoreBlocksAttached: number;
  marks: number;
  marksAttached: number;
  marksUnresolved: number;
  images: number;
  imagesAttached: number;
  tables: number;
  formulas: number;
  status: "COMPLETE" | "PROCESSING_INCOMPLETE";
  problems: string[];
}

export interface DocumentAnalysis {
  documentId: string;
  engineVersion: string;
  profile: DocumentProfile;
  attempts: TestAttempt[];
  instances: QuestionInstance[];
  issues: ProcessingIssue[];
  audit: CoverageAudit;
  stageLog: { stage: string; ms: number; detail: string }[];
}

/* ------------------------------------------------------------------ */
/* Stage 4 — canonical questions (cross-attempt / cross-document)     */
/* ------------------------------------------------------------------ */

export interface CanonicalOption {
  key: string;
  text: string;
  normalizedText: string;
  correctVotes: number;
  incorrectVotes: number;
  selectedCount: number;
  instanceOptionIds: string[];
}

export interface CanonicalQuestionDraft {
  key: string;
  stem: string;
  normalizedStem: string;
  questionType: QuestionType;
  options: CanonicalOption[];
  instanceIds: string[];
  correctKeys: string[];
  correctOrder: string[] | null;
  matching: Record<string, string> | null;
  textAnswer: string | null;
  answerStatus: AnswerStatus;
  confidence: number;
  conflicts: string[];
  reasons: string[];
  hasImage: boolean;
  mergeConfidence: number;
}

export interface SimilarityMatch {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  score: number;
  stemScore: number;
  optionScore: number;
  autoMerge: boolean;
  reason: string;
}
