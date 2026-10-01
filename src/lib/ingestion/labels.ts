export const ANSWER_STATUS_LABEL: Record<string, string> = {
  CONFIRMED_BY_DOCUMENT: "Подтверждён документом",
  CONFIRMED_BY_SCORE: "Подтверждён баллом",
  CONFIRMED_BY_MULTIPLE_ATTEMPTS: "Подтверждён попытками",
  MEDICALLY_VERIFIED: "Проверен по источнику",
  MANUALLY_CONFIRMED: "Подтверждён вручную",
  CONFLICT: "Конфликт",
  NEEDS_REVIEW: "Нужна проверка",
  UNRESOLVED: "Ответ не найден",
};

export const ANSWER_STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  CONFIRMED_BY_DOCUMENT: "ok",
  CONFIRMED_BY_SCORE: "ok",
  CONFIRMED_BY_MULTIPLE_ATTEMPTS: "ok",
  MEDICALLY_VERIFIED: "ok",
  MANUALLY_CONFIRMED: "ok",
  CONFLICT: "bad",
  NEEDS_REVIEW: "warn",
  UNRESOLVED: "muted",
};

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "Один ответ",
  MULTIPLE_CHOICE: "Несколько ответов",
  TRUE_FALSE: "Верно / неверно",
  ORDERING: "Последовательность",
  MATCHING: "Соответствие",
  SHORT_TEXT: "Короткий ответ",
  NUMERIC: "Числовой",
  FORMULA: "Формула",
  IMAGE_LABELING: "Подписи к изображению",
  IMAGE_IDENTIFICATION: "Изображение",
  TABLE: "Таблица",
  COMBINATION: "Комбинация",
  UNKNOWN: "Не определён",
};

export const EXTRACTION_STATUS_LABEL: Record<string, string> = {
  PARSED: "Разобран",
  NEEDS_REVIEW: "Проверить разбор",
  FAILED: "Не разобран",
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  UPLOADING: "Загрузка",
  PROCESSING: "Обработка",
  ANALYZED: "Готов к импорту",
  PROCESSING_INCOMPLETE: "Обработан не полностью",
  IMPORTING: "Импорт",
  IMPORTED: "Импортирован",
  FAILED: "Ошибка",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  MOODLE_EXPORT: "Экспорт Moodle",
  LMS_EXPORT: "Экспорт LMS",
  PLUS_MINUS_BANK: "Банк с +/−",
  NUMBERED_LIST: "Нумерованный список",
  SCANNED: "Скан",
  UNKNOWN: "Не определён",
};

export const TASK_KIND_LABEL: Record<string, string> = {
  ANSWER_CONFLICT: "Конфликт ответа",
  ANSWER_REVIEW: "Проверить ответ",
  NO_ANSWER: "Нет ответа",
  EXTRACTION_FAILED: "Ошибка разбора",
  EXTRACTION_REVIEW: "Проверить разбор",
  POSSIBLE_DUPLICATE: "Возможный дубликат",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  EXPLICIT_CHECKMARK: "Галочка",
  EXPLICIT_CROSS: "Крестик",
  PLUS_MARK: "Плюс",
  MINUS_MARK: "Минус",
  EXPLICIT_TEXT_MARK: "Текстовая метка",
  FEEDBACK_TEXT: "Отзыв / «Правильный ответ»",
  FULL_SCORE: "Полный балл",
  ZERO_SCORE: "Нулевой балл",
  PARTIAL_SCORE: "Частичный балл",
  ATTEMPT_COMPARISON: "Сравнение попыток",
  REPEATED_QUESTION: "Повтор вопроса",
  MEDICAL_SOURCE: "Источник",
  MANUAL_REVIEW: "Ручная проверка",
  VISION: "Распознавание изображения",
  OCR: "OCR",
  UNKNOWN: "Другое",
};

export const SUBJECTS: { slug: string; name: string }[] = [
  { slug: "anatomy", name: "Анатомия" },
  { slug: "histology", name: "Гистология" },
  { slug: "physiology", name: "Физиология" },
  { slug: "biochemistry", name: "Биохимия" },
  { slug: "pharmacology", name: "Фармакология" },
  { slug: "biology", name: "Биология" },
  { slug: "physics", name: "Физика" },
  { slug: "chemistry", name: "Химия" },
  { slug: "other", name: "Другое" },
];

export const subjectName = (slug: string | null | undefined) => SUBJECTS.find((s) => s.slug === slug)?.name ?? slug ?? "Не указан";
