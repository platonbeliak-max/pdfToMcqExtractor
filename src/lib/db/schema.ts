import { boolean, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import type {
  CanonicalOption,
  CoverageAudit,
  DocumentProfile,
  PageInput,
  QuestionInstance,
  TestAttempt,
} from "@/lib/ingestion/types";

export const documents = pgTable("ing_documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size"),
  blobUrl: text("blob_url"),
  blobPathname: text("blob_pathname"),
  pageCount: integer("page_count").notNull().default(0),
  pagesReceived: integer("pages_received").notNull().default(0),
  subjectSlug: text("subject_slug"),
  subjectSource: text("subject_source"),
  status: text("status").notNull().default("UPLOADING"),
  stage: text("stage").notNull().default("UPLOADING"),
  engineVersion: text("engine_version"),
  profile: jsonb("profile").$type<DocumentProfile>(),
  audit: jsonb("audit").$type<CoverageAudit>(),
  summary: jsonb("summary").$type<DocumentSummary>(),
  stageLog: jsonb("stage_log").$type<{ stage: string; ms: number; detail: string }[]>(),
  error: text("error"),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentPages = pgTable(
  "ing_document_pages",
  {
    documentId: text("document_id").notNull(),
    pageNumber: integer("page_number").notNull(),
    source: text("source").notNull(),
    textLayerChars: integer("text_layer_chars").notNull().default(0),
    ocrConfidence: real("ocr_confidence"),
    input: jsonb("input").$type<PageInput>().notNull(),
    rawText: text("raw_text"),
    imageUrl: text("image_url"),
    readErrors: jsonb("read_errors").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.pageNumber] })],
);

export const attempts = pgTable("ing_attempts", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title"),
  state: text("state"),
  scoreEarned: real("score_earned"),
  scoreMax: real("score_max"),
  grade: text("grade"),
  startPage: integer("start_page"),
  endPage: integer("end_page"),
  questionCount: integer("question_count").notNull().default(0),
  data: jsonb("data").$type<TestAttempt>().notNull(),
});

export const questionInstances = pgTable("ing_question_instances", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  canonicalId: text("canonical_id"),
  sequence: integer("sequence").notNull(),
  questionNumber: integer("question_number"),
  physicalPage: integer("physical_page").notNull(),
  questionType: text("question_type").notNull(),
  extractionStatus: text("extraction_status").notNull(),
  answerStatus: text("answer_status").notNull(),
  confidence: real("confidence").notNull(),
  stem: text("stem").notNull(),
  normalizedStem: text("normalized_stem").notNull(),
  data: jsonb("data").$type<QuestionInstance>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const canonicalQuestions = pgTable("ing_canonical_questions", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  subjectSlug: text("subject_slug"),
  topic: text("topic"),
  stem: text("stem").notNull(),
  normalizedStem: text("normalized_stem").notNull(),
  questionType: text("question_type").notNull(),
  options: jsonb("options").$type<CanonicalOption[]>().notNull(),
  correctKeys: jsonb("correct_keys").$type<string[]>().notNull(),
  correctOrder: jsonb("correct_order").$type<string[] | null>(),
  matching: jsonb("matching").$type<Record<string, string> | null>(),
  textAnswer: text("text_answer"),
  answerStatus: text("answer_status").notNull(),
  confidence: real("confidence").notNull(),
  conflicts: jsonb("conflicts").$type<string[]>().notNull().default([]),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  hasImage: boolean("has_image").notNull().default(false),
  reviewStatus: text("review_status").notNull().default("PENDING"),
  instanceCount: integer("instance_count").notNull().default(0),
  documentIds: jsonb("document_ids").$type<string[]>().notNull().default([]),
  inBank: boolean("in_bank").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewTasks = pgTable("ing_review_tasks", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  canonicalId: text("canonical_id"),
  instanceId: text("instance_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("OPEN"),
  reason: text("reason").notNull(),
  resolution: jsonb("resolution").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const processingErrors = pgTable("ing_processing_errors", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  page: integer("page"),
  stage: text("stage").notNull(),
  severity: text("severity").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("ing_verifications", {
  id: serial("id").primaryKey(),
  canonicalId: text("canonical_id").notNull(),
  source: text("source").notNull(),
  verdict: text("verdict").notNull(),
  confidence: real("confidence").notNull(),
  suggestedKeys: jsonb("suggested_keys").$type<string[]>(),
  notes: text("notes"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subjects = pgTable("ing_subjects", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const testRuns = pgTable("ing_test_runs", {
  id: text("id").primaryKey(),
  config: jsonb("config").$type<TestConfig>().notNull(),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  answers: jsonb("answers").$type<Record<string, TestAnswer>>().notNull().default({}),
  score: real("score"),
  maxScore: real("max_score"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface DocumentSummary {
  attempts: number;
  detected: number;
  parsed: number;
  needsReview: number;
  failed: number;
  answerStatus: Record<string, number>;
  questionTypes: Record<string, number>;
  imported?: { canonicals: number; newCanonicals: number; merged: number; reviewTasks: number };
}

export interface TestConfig {
  subjectSlug: string | null;
  count: number;
  questionTypes: string[] | null;
  onlyConfirmed: boolean;
  shuffleOptions: boolean;
  mode: "practice" | "exam";
}

export interface TestAnswer {
  selectedKeys: string[];
  text?: string;
  correct: boolean | null;
}
