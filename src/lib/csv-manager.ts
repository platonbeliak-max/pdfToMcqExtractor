import { StructuredQuestion, MCQQuestion, toStructuredQuestion } from "@/types/question";

export interface CSVImportResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  validQuestions: StructuredQuestion[];
  invalidRows: Array<{ rowNumber: number; reason: string; rowText: string }>;
  duplicateIds: string[];
}

/**
 * Escapes a cell value for standard CSV compatibility.
 * Always wraps in quotes and doubles internal double-quotes.
 */
function escapeCsvCell(val: string | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const clean = String(val).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `"${clean.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV string conforming strictly to Section 46:
 * question,option_a,option_b,option_c,option_d,answer
 * Prepend UTF-8 BOM (\uFEFF) for 100% flawless Bengali rendering in Excel & Google Sheets.
 */
export function exportToStandardCSV(
  questions: Array<StructuredQuestion | MCQQuestion>
): string {
  const headers = ["question", "option_a", "option_b", "option_c", "option_d", "answer"];

  const rows = questions.map((q) => {
    let questionText = "";
    let optA = "";
    let optB = "";
    let optC = "";
    let optD = "";
    let ansKey = "";

    if ("options" in q && Array.isArray(q.options)) {
      const sq = q as StructuredQuestion;
      questionText = sq.question.text;
      optA = sq.options.find((o) => o.key === "A" || o.key === "ক")?.text || "";
      optB = sq.options.find((o) => o.key === "B" || o.key === "খ")?.text || "";
      optC = sq.options.find((o) => o.key === "C" || o.key === "গ")?.text || "";
      optD = sq.options.find((o) => o.key === "D" || o.key === "ঘ")?.text || "";
      ansKey = sq.answer?.key || "";
    } else {
      const mcq = q as MCQQuestion;
      questionText = mcq.question;
      optA = mcq.options?.["A"] || mcq.options?.["ক"] || "";
      optB = mcq.options?.["B"] || mcq.options?.["খ"] || "";
      optC = mcq.options?.["C"] || mcq.options?.["গ"] || "";
      optD = mcq.options?.["D"] || mcq.options?.["ঘ"] || "";
      ansKey = mcq.correctAnswer || "";
    }

    return [
      escapeCsvCell(questionText),
      escapeCsvCell(optA),
      escapeCsvCell(optB),
      escapeCsvCell(optC),
      escapeCsvCell(optD),
      escapeCsvCell(ansKey),
    ].join(",");
  });

  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
}

/**
 * Triggers a download of CSV content in browser.
 */
export function downloadCsvFile(csvContent: string, filename: string = "questions.csv"): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Robust CSV parser that handles quoted cells with commas, newlines, and quotes.
 */
function parseCsvRows(csvText: string): string[][] {
  // Strip BOM if present
  let cleanText = csvText.replace(/^\uFEFF/, "").trim();
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        currentCell += '"';
        i++;
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalizes text for duplicate comparison (removes punctuation, lowercases, collapses whitespace).
 */
export function normalizeQuestionForComparison(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’।॥]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects duplicate questions across a collection.
 * Returns a map of questionId -> array of matching duplicate questionIds.
 */
export function detectDuplicateQuestions(
  questions: Array<StructuredQuestion | MCQQuestion>
): Map<string, string[]> {
  const duplicateMap = new Map<string, string[]>();
  const normalizedMap = new Map<string, string[]>();

  questions.forEach((q) => {
    const id = "id" in q ? q.id : (q as any)._id;
    const text = "question" in q && typeof q.question === "object"
      ? (q as StructuredQuestion).question.text
      : (q as MCQQuestion).question;

    // Every figure question shares one prompt, so its captions are what identify it.
    const figure = Boolean((q as { imageId?: string }).imageId) || Boolean(q.tags?.includes("figure"));
    const captions = figure
      ? Array.isArray(q.options)
        ? (q as StructuredQuestion).options.map((o) => o.text).join("|")
        : Object.values((q as MCQQuestion).options).join("|")
      : "";
    const norm = normalizeQuestionForComparison(text + captions);
    if (!norm) return;

    if (!normalizedMap.has(norm)) {
      normalizedMap.set(norm, [id]);
    } else {
      normalizedMap.get(norm)!.push(id);
    }
  });

  normalizedMap.forEach((ids) => {
    if (ids.length > 1) {
      ids.forEach((id) => {
        const otherIds = ids.filter((other) => other !== id);
        duplicateMap.set(id, otherIds);
      });
    }
  });

  return duplicateMap;
}

/**
 * Imports questions from CSV conforming strictly to Section 18.
 * Expected columns: question, option_a, option_b, option_c, option_d, answer
 */
export function importFromStandardCSV(csvText: string): CSVImportResult {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    return {
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      validQuestions: [],
      invalidRows: [{ rowNumber: 1, reason: "Empty CSV file", rowText: "" }],
      duplicateIds: [],
    };
  }

  // Header detection
  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const qIdx = headerRow.findIndex((h) => h === "question" || h === "question_text");
  const aIdx = headerRow.findIndex((h) => h === "option_a" || h === "optiona" || h === "a");
  const bIdx = headerRow.findIndex((h) => h === "option_b" || h === "optionb" || h === "b");
  const cIdx = headerRow.findIndex((h) => h === "option_c" || h === "optionc" || h === "c");
  const dIdx = headerRow.findIndex((h) => h === "option_d" || h === "optiond" || h === "d");
  const ansIdx = headerRow.findIndex((h) => h === "answer" || h === "correct_answer");

  const dataRows = qIdx !== -1 ? rows.slice(1) : rows;

  const validQuestions: StructuredQuestion[] = [];
  const invalidRows: Array<{ rowNumber: number; reason: string; rowText: string }> = [];
  const seenNorms = new Set<string>();
  const duplicateIds: string[] = [];

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const rawRowText = row.join(", ");

    const questionText = (qIdx !== -1 ? row[qIdx] : row[0]) || "";
    const optA = (aIdx !== -1 ? row[aIdx] : row[1]) || "";
    const optB = (bIdx !== -1 ? row[bIdx] : row[2]) || "";
    const optC = (cIdx !== -1 ? row[cIdx] : row[3]) || "";
    const optD = (dIdx !== -1 ? row[dIdx] : row[4]) || "";
    const ansKey = ((ansIdx !== -1 ? row[ansIdx] : row[5]) || "").toUpperCase().trim();

    if (!questionText || questionText.length < 3) {
      invalidRows.push({
        rowNumber: rowNum,
        reason: "Missing or invalid question text",
        rowText: rawRowText,
      });
      return;
    }

    if (!optA || !optB) {
      invalidRows.push({
        rowNumber: rowNum,
        reason: "Must have at least Option A and Option B",
        rowText: rawRowText,
      });
      return;
    }

    const options = [
      { key: "A", text: optA },
      { key: "B", text: optB },
    ];
    if (optC) options.push({ key: "C", text: optC });
    if (optD) options.push({ key: "D", text: optD });

    const qId = `csv-${Date.now()}-${idx}`;
    const norm = normalizeQuestionForComparison(questionText);

    let isDuplicate = false;
    if (seenNorms.has(norm)) {
      isDuplicate = true;
      duplicateIds.push(qId);
    } else {
      seenNorms.add(norm);
    }

    const answerItem = ansKey ? { key: ansKey, text: options.find((o) => o.key === ansKey)?.text || "" } : null;

    const sq: StructuredQuestion = {
      _id: qId,
      id: qId,
      questionNumber: validQuestions.length + 1,
      question: { text: questionText },
      options,
      answer: answerItem,
      source: {
        documentId: "csv-import",
        documentName: "imported.csv",
        pageNumber: 1,
      },
      confidence: {
        question: 0.99,
        options: 0.98,
        answer: ansKey ? 0.99 : 0.0,
        overall: ansKey ? 0.99 : 0.85,
        level: ansKey ? "high" : "medium",
      },
      status: ansKey ? "verified" : "pending",
      category: "Imported CSV",
      tags: ["CSV Import"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    validQuestions.push(sq);
  });

  return {
    totalRows: dataRows.length,
    validCount: validQuestions.length,
    invalidCount: invalidRows.length,
    duplicateCount: duplicateIds.length,
    validQuestions,
    invalidRows,
    duplicateIds,
  };
}
