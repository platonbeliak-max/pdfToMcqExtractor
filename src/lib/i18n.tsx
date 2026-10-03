"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ru" | "en";

const DICT = {
  ru: {
    brand: "Банк вопросов из PDF",
    brandSub: "Извлечение тестов • Русский / English",
    navDashboard: "Обзор",
    navExtract: "Загрузка PDF",
    navBank: "База вопросов",
    navBankShort: "База",
    navSvg: "SVG",
    newPdf: "Новый PDF",
    heroBadge: "Для студентов: соберите базу тестов из PDF",
    heroTitle1: "Все вопросы из ваших PDF-тестов",
    heroTitle2: "с правильными ответами",
    heroText:
      "Загрузите PDF с результатами тестов (Moodle и другие). Сайт найдёт каждый вопрос, объединит повторы из разных попыток и соберёт правильные ответы. Если ответа в файле нет, вопрос получит пометку «Нужно ответить».",
    chooseLang: "Язык интерфейса",
    guideTitle: "Как пользоваться",
    step1T: "Загрузите PDF",
    step1D: "Перетащите файл или выберите его на компьютере. Можно загружать несколько файлов по очереди.",
    step2T: "Дождитесь разбора",
    step2D: "Страницы читаются прямо в браузере, файл никуда не отправляется. Сканы распознаются автоматически.",
    step3T: "Проверьте базу",
    step3D: "Одинаковые вопросы объединены. Верные ответы подсвечены зелёным, вопросы без ответа помечены.",
    step4T: "Составьте тест",
    step4D: "Во вкладке «Тест» выберите число вопросов и проверьте себя. Ошибки можно повторить.",
    dropTitle: "Перетащите PDF сюда",
    dropText: "Поддерживаются русский и английский, текстовые PDF и сканы.",
    browse: "Выбрать PDF на компьютере",
    maxSize: "До 150 МБ • только PDF",
    extractNow: "Извлечь вопросы",
    removeFile: "Убрать файл",
    ocrMode: "Режим OCR",
    ocrAuto: "Авто",
    ocrForce: "Принудительный OCR",
    ocrNone: "Только текст",
    ocrHint: "Если текст в PDF «сломан», выберите принудительный OCR.",
    uploadError: "Ошибка загрузки: ",
    errType: "Неверный тип файла. Загрузите PDF.",
    errSize: "Файл слишком большой. Максимум 150 МБ.",
    errEmpty: "Файл пустой.",
    questions: "вопросов",
    question: "Вопрос",
    page: "Стр.",
    correctAnswer: "Правильный ответ",
    correctAnswers: "Правильные ответы",
    needAnswer: "Нужно ответить",
    needAnswerLong: "Ответа в файле нет — нужно ответить",
    foundTimes: "Найден раз",
    edited: "Изменён",
    copyQ: "Копир. вопрос",
    copyOpt: "Копир. варианты",
    copyAns: "Копир. ответ",
    copyFull: "Копировать всё",
    textAnswer: "Ответ вводится текстом",
    approveAll: "Подтвердить все",
    hidePdf: "Скрыть PDF",
    showPdf: "Показать PDF",
    noMatch: "Нет подходящих вопросов",
    resultTitle: "Готово",
    resultText: "Найдено {total} вопросов в файле, уникальных: {unique}. С ответом: {ans}. Нужно ответить: {miss}.",
    toastDoneT: "Извлечение завершено",
    toastNone: "Вопросы не найдены",
    toastNoneD: "Убедитесь, что в файле есть тестовые вопросы",
    answer: "Ответ",
    notDetected: "Нужно ответить",
    searchBank: "Поиск по вопросам, вариантам, ответам...",
    addQuestion: "Добавить вопрос",
    importCsv: "Импорт CSV",
    exportCsv: "Экспорт CSV",
    all: "Все",
    withAnswer: "С ответом",
    noAnswer: "Нужно ответить",
    approved: "Подтверждённые",
    pending: "Ожидают",
    duplicates: "Повторы",
    noQuestions: "Вопросов нет",
    noQuestionsText: "Загрузите PDF или измените фильтры.",
    navTest: "Тест",
    testEmptyT: "Пока не из чего составить тест",
    testEmptyD: "Загрузите PDF: в тест попадут уникальные вопросы, у которых найден правильный ответ.",
    testSetupT: "Составить тест",
    testPool: "Доступно уникальных вопросов с ответом: {n}.",
    testSkipped: "Ещё {n} без ответа не включены — ответьте на них в «Базе вопросов».",
    testCount: "Сколько вопросов",
    testAll: "Все ({n})",
    testShuffle: "Перемешивать варианты ответов",
    testStart: "Начать тест",
    testFinish: "Завершить",
    testNext: "Дальше",
    testCheck: "Проверить",
    testRight: "Верно",
    testWrong: "Неверно",
    testMulti: "Несколько верных ответов: {n}",
    testResult: "Результат",
    testScore: "Верно {s} из {n}",
    testRetryWrong: "Повторить ошибки ({n})",
    testNew: "Новый тест",
    testMistakes: "Ошибки",
    reset: "Сбросить текущий разбор и загрузить новый PDF?",
    toastSaved: "Вопрос сохранён",
    toastDeleted: "Вопрос удалён",
    toastApproved: "Все вопросы подтверждены",
    toastExtracted: "В базу добавлено вопросов: {n}",
    toastError: "Ошибка извлечения",
  },
  en: {
    brand: "PDF Question Bank",
    brandSub: "Test extraction • Русский / English",
    navDashboard: "Overview",
    navExtract: "Upload PDF",
    navBank: "Question Bank",
    navBankShort: "Bank",
    navSvg: "SVG",
    newPdf: "New PDF",
    heroBadge: "For students: build a test bank from PDFs",
    heroTitle1: "Every question from your PDF tests",
    heroTitle2: "with the correct answers",
    heroText:
      "Upload a PDF of test results (Moodle and others). The site finds every question, merges repeats from different attempts and collects the correct answers. If the file has no answer, the question is flagged “Needs answer”.",
    chooseLang: "Interface language",
    guideTitle: "How it works",
    step1T: "Upload a PDF",
    step1D: "Drag a file in or pick it on your computer. You can upload several files one by one.",
    step2T: "Wait for parsing",
    step2D: "Pages are read in your browser, the file never leaves your device. Scans are recognised automatically.",
    step3T: "Check the bank",
    step3D: "Identical questions are merged. Correct answers are green, unanswered questions are flagged.",
    step4T: "Build a test",
    step4D: "In the “Test” tab pick how many questions and check yourself. Retry your mistakes.",
    dropTitle: "Drop your PDF here",
    dropText: "Russian and English, text PDFs and scans are supported.",
    browse: "Choose a PDF from computer",
    maxSize: "Up to 150 MB • PDF only",
    extractNow: "Extract questions",
    removeFile: "Remove file",
    ocrMode: "OCR mode",
    ocrAuto: "Auto",
    ocrForce: "Force OCR",
    ocrNone: "Text only",
    ocrHint: "If the PDF text looks broken, choose Force OCR.",
    uploadError: "Upload error: ",
    errType: "Invalid file type. Please upload a PDF.",
    errSize: "File is too large. Maximum is 150 MB.",
    errEmpty: "The file is empty.",
    questions: "questions",
    question: "Question",
    page: "Page",
    correctAnswer: "Correct answer",
    correctAnswers: "Correct answers",
    needAnswer: "Needs answer",
    needAnswerLong: "No answer in the file — needs an answer",
    foundTimes: "Found",
    edited: "Edited",
    copyQ: "Copy Q",
    copyOpt: "Copy options",
    copyAns: "Copy answer",
    copyFull: "Copy all",
    textAnswer: "Free-text answer",
    approveAll: "Approve all",
    hidePdf: "Hide PDF",
    showPdf: "Show PDF",
    noMatch: "No matching questions",
    resultTitle: "Done",
    resultText: "Found {total} questions in the file, {unique} unique. Answered: {ans}. Needs answer: {miss}.",
    toastDoneT: "Extraction complete",
    toastNone: "No questions found",
    toastNoneD: "Make sure the file contains test questions",
    answer: "Answer",
    notDetected: "Needs answer",
    searchBank: "Search questions, options, answers...",
    addQuestion: "Add question",
    importCsv: "Import CSV",
    exportCsv: "Export CSV",
    all: "All",
    withAnswer: "Answered",
    noAnswer: "Needs answer",
    approved: "Approved",
    pending: "Pending",
    duplicates: "Duplicates",
    noQuestions: "No questions",
    noQuestionsText: "Upload a PDF or adjust the filters.",
    navTest: "Test",
    testEmptyT: "Nothing to build a test from yet",
    testEmptyD: "Upload a PDF: the test uses unique questions that have a correct answer.",
    testSetupT: "Build a test",
    testPool: "Unique questions with an answer: {n}.",
    testSkipped: "{n} more without an answer are excluded — answer them in “Question Bank”.",
    testCount: "Number of questions",
    testAll: "All ({n})",
    testShuffle: "Shuffle answer options",
    testStart: "Start test",
    testFinish: "Finish",
    testNext: "Next",
    testCheck: "Check",
    testRight: "Correct",
    testWrong: "Wrong",
    testMulti: "Several correct answers: {n}",
    testResult: "Result",
    testScore: "{s} of {n} correct",
    testRetryWrong: "Retry mistakes ({n})",
    testNew: "New test",
    testMistakes: "Mistakes",
    reset: "Reset the current extraction and upload a new PDF?",
    toastSaved: "Question saved",
    toastDeleted: "Question deleted",
    toastApproved: "All questions approved",
    toastExtracted: "Questions added to the bank: {n}",
    toastError: "Extraction error",
  },
} as const;

export type TKey = keyof (typeof DICT)["ru"];

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<Ctx | null>(null);
const STORAGE = "pdf-bank-lang";

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE);
    if (saved === "ru" || saved === "en") setLangState(saved);
    else if (!navigator.language.toLowerCase().startsWith("ru")) setLangState("en");
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE, l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      let s: string = DICT[lang][key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT() {
  const c = useContext(LangContext);
  if (!c) throw new Error("useT must be used inside LangProvider");
  return c;
}

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div role="group" aria-label="Language" className={`inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold ${className}`}>
      {(["ru", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`px-3 py-1.5 rounded-[10px] transition-colors ${
            lang === l ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          {l === "ru" ? "Русский" : "English"}
        </button>
      ))}
    </div>
  );
}
