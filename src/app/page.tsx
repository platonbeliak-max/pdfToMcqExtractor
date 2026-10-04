"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Navbar, PlatformTab } from "@/components/navbar";
import { LandingHero } from "@/components/landing-hero";
import { PdfUploader } from "@/components/pdf-uploader";
import { ExtractionProgressView } from "@/components/extraction-progress";
import { StatsCard } from "@/components/stats-card";
import { QuestionCard } from "@/components/question-card";
import { QuestionEditor } from "@/components/question-editor";
import { SearchBar, FilterOption } from "@/components/search-bar";
import { ExportMenu } from "@/components/export-menu";
import { PdfPreview } from "@/components/pdf-preview";
import { useToast } from "@/components/toast";
import { DashboardView } from "@/components/dashboard-view";
import { QuestionBankView } from "@/components/question-bank-view";
import { SvgEditorModal } from "@/components/svg-editor-modal";
import { TestView } from "@/components/test-view";
import { useT } from "@/lib/i18n";
import {
  MCQQuestion,
  StructuredQuestion,
  DocumentRecord,
  ExtractionStats,
  ExtractionProgress,
  toStructuredQuestion,
  toMCQQuestion,
} from "@/types/question";
import { extractTextFromPDFClient, type ClientExtractionResult } from "@/lib/client-pdf-parser";
import { parseMCQDocument } from "@/lib/question-parser";
import {
  loadSavedQuestions,
  persistQuestions,
  loadSavedDocuments,
  registerDocument,
  deleteDocumentWithQuestions,
  clearAllStorage,
} from "@/lib/question-store";
import type { TestMode } from "@/components/test-view";
import {
  Sparkles,
  FileText,
  AlertCircle,
  Eye,
  EyeOff,
  Layers,
  CheckCircle,
  Cpu,
  BookOpen,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import confetti from "canvas-confetti";
import { isScrambledBijoyText } from "@/lib/text-normalizer";
import { hasAnswer } from "@/lib/answerable";
import { lookupAiAnswer, NoAnswerError, AiBillingError, AiRateLimitError, LOOKUP_VERSION } from "@/lib/ai-answer";

const STORAGE_KEY = "pdf-mcq-saved-session";

export default function Home() {
  const [activeTab, setActiveTab] = useState<PlatformTab>("dashboard");

  // Persistent Question Bank state
  const [allQuestions, setAllQuestions] = useState<StructuredQuestion[]>([]);
  const [testMode, setTestMode] = useState<TestMode>("all");
  const [allDocuments, setAllDocuments] = useState<DocumentRecord[]>([]);

  // Current upload session state
  const [pdfFile, setPdfFile] = useState<File | Blob | null>(null);
  const [filename, setFilename] = useState<string>("exam-questions.pdf");
  const [currentQuestions, setCurrentQuestions] = useState<MCQQuestion[]>([]);
  const [stats, setStats] = useState<ExtractionStats | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBijoyDetected, setIsBijoyDetected] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress>({
    step: "idle",
    message: "",
    percent: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Split-screen & Selection state
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [activePdfPage, setActivePdfPage] = useState<number>(1);
  const [showPdfPreview, setShowPdfPreview] = useState<boolean>(true);

  // Modals
  const [editingQuestion, setEditingQuestion] = useState<MCQQuestion | null>(null);
  const [svgStudioTarget, setSvgStudioTarget] = useState<StructuredQuestion | null>(null);

  // Search & Filter within current extraction review
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");

  const { showToast } = useToast();
  const { t } = useT();

  // Load saved session and persistent question bank on initial render
  useEffect(() => {
    try {
      const savedBank = loadSavedQuestions();
      setAllQuestions(savedBank);

      const savedDocs = loadSavedDocuments();
      setAllDocuments(savedDocs);

      const savedSession = localStorage.getItem(STORAGE_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed.questions && parsed.questions.length > 0) {
          setCurrentQuestions(parsed.questions);
          setStats(parsed.stats || null);
          setFilename(parsed.filename || "saved-mcq.pdf");
        }
      }

      // If bank has questions, start at dashboard; otherwise upload
      if (savedBank.length === 0 && (!savedSession || JSON.parse(savedSession)?.questions?.length === 0)) {
        setActiveTab("upload");
      }
    } catch (e) {
      console.warn("Failed to load initial data:", e);
    }
  }, []);

  const latestBankRef = useRef<StructuredQuestion[]>([]);
  const autoRunningRef = useRef(false);
  const autoFailedRef = useRef<Set<string>>(new Set());
  const autoBlockedRef = useRef(false);
  const unmountedRef = useRef(false);
  const [autoKick, setAutoKick] = useState(0);
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    latestBankRef.current = allQuestions;
    const isTarget = (q: StructuredQuestion) =>
      !hasAnswer(q) &&
      (q.lookupVersion ?? 0) < LOOKUP_VERSION &&
      !autoFailedRef.current.has(q.id) &&
      q.question.text.trim().length >= 3;
    if (autoRunningRef.current || autoBlockedRef.current) return;
    const queued = allQuestions.filter(isTarget).length;
    if (queued === 0) return;

    autoRunningRef.current = true;
    let done = 0;
    let found = 0;
    const total = queued;
    setAutoProgress({ done, total });

    const commit = (result: StructuredQuestion) => {
      const next = latestBankRef.current.map((q) => (q.id === result.id ? result : q));
      latestBankRef.current = next;
      setAllQuestions(next);
      persistQuestions(next);
    };

    const inFlight = new Set<string>();
    const worker = async () => {
      while (!unmountedRef.current && !autoBlockedRef.current) {
        const target = latestBankRef.current.find((q) => isTarget(q) && !inFlight.has(q.id));
        if (!target) break;
        inFlight.add(target.id);
        try {
          commit(await lookupAiAnswer(target));
          found++;
        } catch (err) {
          if (err instanceof NoAnswerError) {
            commit({ ...target, aiTried: true, lookupVersion: LOOKUP_VERSION });
          } else if (err instanceof AiRateLimitError || err instanceof AiBillingError) {
            autoBlockedRef.current = true;
          } else {
            autoFailedRef.current.add(target.id);
          }
        } finally {
          inFlight.delete(target.id);
        }
        done++;
        setAutoProgress({ done, total: Math.max(total, done) });
      }
    };

    (async () => {
      try {
        await Promise.all(Array.from({ length: 3 }, worker));
      } finally {
        autoRunningRef.current = false;
        if (!unmountedRef.current) {
          setAutoProgress(null);
          if (found > 0) showToast(t("autoAnswersDone", { n: found }), t("autoAnswersBody"), "success");
          if (!autoBlockedRef.current && latestBankRef.current.some(isTarget)) setAutoKick((k) => k + 1);
        }
      }
    })();
  }, [allQuestions, autoKick]);

  const handleUpdateBankQuestions = (updated: StructuredQuestion[]) => {
    setAllQuestions(updated);
    persistQuestions(updated);
  };

  const handleStartExtraction = async (
    file: File | Blob,
    name: string,
    options: { useAi: boolean; apiKey?: string; useOcr: string }
  ) => {
    setIsProcessing(true);
    setError(null);
    setPdfFile(file);
    setFilename(name);
    setActiveTab("upload");

    setProgress({
      step: "analyzing",
      message: t("progAnalyzing"),
      percent: 15,
    });

    try {
      let extractedQuestions: MCQQuestion[] = [];
      let computedStats: ExtractionStats = {
        totalQuestions: 0,
        answeredCount: 0,
        unansweredCount: 0,
        needsReviewCount: 0,
        totalPages: 1,
        isOcrUsed: false,
      };

      // Client-side extraction handles files up to 150MB in browser without 413 error
      setProgress({
        step: "extracting",
        message: t("progReading"),
        percent: 25,
      });

      const arrayBuffer = await file.arrayBuffer();
      // pdf.js transfers (detaches) the buffer it receives, so keep a copy for the engine fallback.
      const engineBytes = arrayBuffer.slice(0);
      const runEngine = async () => {
        setProgress({ step: "detecting_questions", message: t("progEngine"), percent: 88 });
        const { extractWithEngine } = await import("@/lib/ingestion/to-mcq");
        return extractWithEngine(engineBytes, { ocr: options.useOcr === "force" ? "force" : "auto" });
      };
      // The universal engine is the primary extractor; the legacy parser only runs when it finds nothing.
      const engineFirst = await runEngine().catch((e) => {
        console.warn("Engine extraction failed, falling back to legacy parser:", e);
        return null;
      });
      if (engineFirst && engineFirst.questions.length > 0) extractedQuestions = engineFirst.questions;
      const clientRes: ClientExtractionResult = extractedQuestions.length > 0 && !options.useAi
        ? { success: true, totalPages: engineFirst!.pageCount, pages: [], fullText: "", isScanned: false }
        : await extractTextFromPDFClient(
        arrayBuffer,
        (curr, total, msg) => {
          setProgress({
            step: options.useOcr === "force" ? "ocr" : "extracting",
            message: options.useOcr === "force" ? t("progOcrPage", { n: curr, total }) : t("progPage", { n: curr, total }),
            percent: Math.min(85, Math.round(25 + (curr / total) * 60)),
          });
        },
        { forceOcr: options.useOcr === "force", lang: "rus+eng" }
      );

      if (!clientRes.success) {
        console.warn("Legacy parser error:", clientRes.error);
        const legacyError = t("errExtractFail");
        const engineRes = await runEngine().catch((e) => {
          console.error("Engine fallback failed:", e);
          return null;
        });
        if (!engineRes) throw new Error(legacyError);
        clientRes.success = true;
        clientRes.pages = [];
        clientRes.fullText = "";
        clientRes.totalPages = engineRes.pageCount;
        extractedQuestions = engineRes.questions;
      }

      // If AI extraction requested, send clean JSON text to /api/extract
      if (options.useAi && (options.apiKey || process.env.NEXT_PUBLIC_HAS_AI)) {
        setProgress({
          step: "detecting_answers",
          message: t("progAi"),
          percent: 85,
        });

        try {
          const aiRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fullText: clientRes.fullText,
              pages: clientRes.pages,
              totalPages: clientRes.totalPages,
              useAi: true,
              apiKey: options.apiKey,
            }),
          });

          const contentType = aiRes.headers.get("content-type") || "";
          if (aiRes.ok && contentType.includes("application/json")) {
            const aiData = await aiRes.json();
            if (aiData.success && aiData.questions?.length > 0) {
              extractedQuestions = aiData.questions;
              computedStats = aiData.stats;
            }
          }
        } catch (aiErr) {
          console.warn("AI extraction fallback to deterministic engine:", aiErr);
        }
      }

      // Deterministic parsing with strict noise filtering & question isolation
      if (extractedQuestions.length === 0) {
        setProgress({
          step: "detecting_questions",
          message: t("progIsolating"),
          percent: 90,
        });

        extractedQuestions = parseMCQDocument(clientRes.pages, clientRes.fullText);
        if (extractedQuestions.length === 0) {
          try {
            extractedQuestions = (await runEngine()).questions;
          } catch (e) {
            console.warn("Engine fallback failed:", e);
          }
        }
      }
      if (!computedStats || computedStats.totalQuestions !== extractedQuestions.length) {
        computedStats = {
          totalQuestions: extractedQuestions.length,
          answeredCount: extractedQuestions.filter((q) => q.status === "answered").length,
          unansweredCount: extractedQuestions.filter((q) => q.status === "missing_answer").length,
          needsReviewCount: extractedQuestions.filter((q) => q.confidence === "needs-review").length,
          totalPages: clientRes.totalPages,
          isOcrUsed: clientRes.isScanned,
        };
      }

      setProgress({
        step: "completed",
        message: t("progCompleted"),
        percent: 100,
      });

      setCurrentQuestions(extractedQuestions);
      setStats(computedStats);

      const hasBijoyPatterns =
        clientRes.isBijoyScrambled ||
        extractedQuestions.some((q) => isScrambledBijoyText(q.question));
      setIsBijoyDetected(Boolean(hasBijoyPatterns && options.useOcr !== "force"));

      // Register Document & Merge into Question Bank
      const docRecord = registerDocument(
        name,
        file.size,
        clientRes.totalPages,
        extractedQuestions.length,
        clientRes.isScanned ? "scanned" : "text"
      );
      setAllDocuments(loadSavedDocuments());

      const structuredItems = extractedQuestions.map((q) =>
        toStructuredQuestion(q, docRecord.id, name)
      );
      const updatedBank = [...structuredItems, ...allQuestions];
      setAllQuestions(updatedBank);
      persistQuestions(updatedBank);

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          questions: extractedQuestions,
          stats: computedStats,
          filename: name,
          updatedAt: new Date().toISOString(),
        })
      );

      if (extractedQuestions.length > 0) {
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
        });
        showToast(t("toastDoneT"), t("toastExtracted", { n: extractedQuestions.length }), "success");
      } else {
        showToast(t("toastNone"), t("toastNoneD"), "info");
      }
    } catch (err: unknown) {
      console.error("Extraction failed:", err);
      const msg = t("errProcess");
      setError(msg);
      setProgress({ step: "error", message: msg, percent: 0 });
      showToast(t("toastError"), msg, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveQuestion = (updated: MCQQuestion) => {
    const nextQuestions = currentQuestions.map((q) => (q.id === updated.id ? updated : q));
    setCurrentQuestions(nextQuestions);

    // Update in allQuestions
    const sq = toStructuredQuestion(updated);
    const nextBank = allQuestions.map((q) => (q.id === sq.id ? sq : q));
    setAllQuestions(nextBank);
    persistQuestions(nextBank);

    if (stats) {
      const updatedStats: ExtractionStats = {
        ...stats,
        answeredCount: nextQuestions.filter((q) => q.status === "answered").length,
        unansweredCount: nextQuestions.filter((q) => q.status === "missing_answer").length,
        needsReviewCount: nextQuestions.filter((q) => q.confidence === "needs-review").length,
      };
      setStats(updatedStats);
    }
    showToast(t("toastSaved"), undefined, "success");
  };

  const handleDeleteQuestion = (id: string) => {
    const nextQuestions = currentQuestions.filter((q) => q.id !== id);
    setCurrentQuestions(nextQuestions);

    const nextBank = allQuestions.filter((q) => q.id !== id);
    setAllQuestions(nextBank);
    persistQuestions(nextBank);

    showToast(t("toastDeleted"), undefined, "info");
  };

  const handleApproveAllCurrent = () => {
    const approved = currentQuestions.map((q) => ({
      ...q,
      verificationStatus: "verified" as const,
    }));
    setCurrentQuestions(approved);

    const approvedSQ = approved.map((q) => toStructuredQuestion(q));
    const nextBank = allQuestions.map((q) => {
      const match = approvedSQ.find((a) => a.id === q.id);
      return match ? { ...q, status: "verified" as const } : q;
    });
    setAllQuestions(nextBank);
    persistQuestions(nextBank);

    showToast(t("toastApproved"), String(approved.length), "success");
  };

  const handleSelectQuestion = (q: MCQQuestion) => {
    setSelectedQuestionId(q.id);
    if (q.pageNumber) {
      setActivePdfPage(q.pageNumber);
    }
  };

  const handleResetSession = () => {
    if (confirm(t("reset"))) {
      setCurrentQuestions([]);
      setStats(null);
      setPdfFile(null);
      setSelectedQuestionId(null);
      setError(null);
      setIsBijoyDetected(false);
      localStorage.removeItem(STORAGE_KEY);
      setActiveTab("upload");
      
    }
  };

  const handleDeleteDocument = (doc: DocumentRecord) => {
    if (!confirm(t("dDeleteConfirm", { name: doc.fileName }))) return;
    const next = deleteDocumentWithQuestions(doc, allQuestions);
    setAllDocuments(next.documents);
    setAllQuestions(next.questions);
  };

  const handleClearAll = () => {
    if (!confirm(t("dClearConfirm"))) return;
    clearAllStorage(STORAGE_KEY);
    setAllDocuments([]);
    setAllQuestions([]);
    setCurrentQuestions([]);
    setStats(null);
    setPdfFile(null);
    setSelectedQuestionId(null);
    setError(null);
    setIsBijoyDetected(false);
  };

  const handleStartTest = (mode: TestMode) => {
    setTestMode(mode);
    setActiveTab("test");
  };

  // Filter & Search calculations for review screen
  const filteredQuestions = useMemo(() => {
    return currentQuestions.filter((q) => {
      if (activeFilter === "answered" && q.status !== "answered") return false;
      if (activeFilter === "missing_answer" && q.status !== "missing_answer") return false;
      if (activeFilter === "needs_review" && q.confidence !== "needs-review") return false;
      if (activeFilter === "high_confidence" && q.confidence !== "high") return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesNum = String(q.number).includes(query);
        const matchesQuestion = q.question.toLowerCase().includes(query);
        const matchesOptions = Object.values(q.options || {}).some((opt) =>
          opt.toLowerCase().includes(query)
        );
        return matchesNum || matchesQuestion || matchesOptions;
      }

      return true;
    });
  }, [currentQuestions, activeFilter, searchQuery]);

  const filterCounts = useMemo(() => {
    return {
      all: currentQuestions.length,
      answered: currentQuestions.filter((q) => q.status === "answered").length,
      missing_answer: currentQuestions.filter((q) => q.status === "missing_answer").length,
      needs_review: currentQuestions.filter((q) => q.confidence === "needs-review").length,
      high_confidence: currentQuestions.filter((q) => q.confidence === "high").length,
    };
  }, [currentQuestions]);

  return (
  <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
    {autoProgress && (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] px-4 py-2 rounded-full bg-sky-600 text-white text-xs font-bold shadow-lg"
      >
        {t("autoAnswersRunning", { done: autoProgress.done, total: autoProgress.total })}
      </div>
    )}
    <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        questionCount={allQuestions.length}
        hasExtractedData={currentQuestions.length > 0}
        onReset={handleResetSession}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* VIEW A: DASHBOARD VIEW */}
        {activeTab === "dashboard" && (
          <DashboardView
            questions={allQuestions}
            documents={allDocuments}
            onNavigateTab={setActiveTab}
            onDeleteDocument={handleDeleteDocument}
            onClearAll={handleClearAll}
            onStartTest={handleStartTest}
          />
        )}

        {/* VIEW B: QUESTION BANK VIEW */}
        {activeTab === "bank" && (
          <QuestionBankView
            questions={allQuestions}
            onUpdateQuestions={handleUpdateBankQuestions}
            onViewSource={(p) => {
              setActivePdfPage(p);
              setActiveTab("upload");
            }}
          />
        )}

        {/* VIEW C: UPLOAD & EXTRACTION REVIEW WORKSPACE */}
        {activeTab === "upload" && (
          <div>
            {/* Step 1: Upload Dropzone if no active extraction */}
            {!isProcessing && currentQuestions.length === 0 && (
              <div className="py-6 sm:py-12 space-y-12">
                <LandingHero />

                <PdfUploader
                  onFileSelect={(file, opts) => handleStartExtraction(file, file.name, opts)}
                  isLoading={isProcessing}
                />

              </div>
            )}

            {/* Step 2: Processing indicator */}
            {isProcessing && (
              <div className="py-16 sm:py-24">
                <ExtractionProgressView
                  progress={progress}
                  totalExtracted={currentQuestions.length}
                />
              </div>
            )}

            {/* Step 3: Split-Screen Review Workspace */}
            {!isProcessing && currentQuestions.length > 0 && (
              <div className="space-y-6">
                {/* Stats Card */}
                {stats && <StatsCard stats={stats} />}

                {/* Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate max-w-[200px] sm:max-w-xs">
                      {filename}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold">
                      {currentQuestions.length} {t("questions")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApproveAllCurrent}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t("approveAll")}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPdfPreview(!showPdfPreview)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      {showPdfPreview ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t("hidePdf")}</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t("showPdf")}</span>
                        </>
                      )}
                    </button>

                    <ExportMenu questions={currentQuestions} filename={filename} />

                    <button
                      type="button"
                      onClick={handleResetSession}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title={t("newPdf")}
                      aria-label={t("newPdf")}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Split-Screen Review Container */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column: PDF Preview */}
                  {showPdfPreview && (
                    <div className="lg:col-span-5 h-[650px] lg:sticky lg:top-20">
                      <PdfPreview
                        pdfFile={pdfFile}
                        targetPage={activePdfPage}
                        totalPages={stats?.totalPages || 1}
                        onPageChange={(p) => setActivePdfPage(p)}
                      />
                    </div>
                  )}

                  {/* Right Column: Question Cards */}
                  <div
                    className={`${
                      showPdfPreview ? "lg:col-span-7" : "lg:col-span-12"
                    } space-y-4`}
                  >
                    <SearchBar
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                      activeFilter={activeFilter}
                      onFilterChange={setActiveFilter}
                      counts={filterCounts}
                    />

                    {filteredQuestions.length === 0 ? (
                      <div className="p-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
                        <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                          {t("noMatch")}
                        </h4>
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        {filteredQuestions.map((q) => (
                          <QuestionCard
                            key={q.id}
                            question={q}
                            isSelected={selectedQuestionId === q.id}
                            onSelect={handleSelectQuestion}
                            onEdit={(target) => setEditingQuestion(target)}
                            onDelete={handleDeleteQuestion}
                            onOpenSvg={(target) => setSvgStudioTarget(toStructuredQuestion(target))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "test" && (
          <TestView key={testMode} questions={allQuestions} initialMode={testMode} onGoUpload={() => setActiveTab("upload")} />
        )}

        {/* VIEW D: SVG STUDIO STANDALONE TAB */}
        {activeTab === "svg-studio" && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {t("svgStudioT")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("svgStudioD")}
                </p>
              </div>
            </div>

            {allQuestions.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <Sparkles className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                  {t("svgNoneT")}
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {t("svgNoneD")}
                </p>
                <button
                  onClick={() => setActiveTab("upload")}
                  className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs"
                >
                  {t("svgUploadNow")}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {allQuestions.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => setSvgStudioTarget(q)}
                    className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 cursor-pointer transition-all shadow-2xs hover:shadow-xs"
                  >
                    <div className="flex items-center justify-between text-xs font-bold mb-2">
                      <span className="text-blue-600">{t("svgQ", { n: q.questionNumber })}</span>
                      <span className="text-amber-500 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> SVG
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                      {q.question.text}
                    </p>
                    <div className="mt-2 text-[10px] text-slate-400">
                      {t("svgAns", { a: q.answer?.key || t("svgNoAns"), n: q.options.length })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Question Editor Modal */}
      {editingQuestion && (
        <QuestionEditor
          question={editingQuestion}
          isOpen={true}
          onSave={handleSaveQuestion}
          onClose={() => setEditingQuestion(null)}
        />
      )}

      {/* SVG Studio Modal */}
      {svgStudioTarget && (
        <SvgEditorModal
          question={svgStudioTarget}
          isOpen={Boolean(svgStudioTarget)}
          onClose={() => setSvgStudioTarget(null)}
        />
      )}
    </div>
  );
}
