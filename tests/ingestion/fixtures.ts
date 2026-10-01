import type { PageInput, RawTextItem } from "../../src/lib/ingestion/types";

/**
 * Builds a PageInput from a simple layout DSL. Each entry is a line;
 * "|"-separated segments are placed as separate cells (side box, glyph
 * column). `gap` adds extra vertical space before the line.
 */
export interface LineSpec {
  text: string;
  x?: number;
  gap?: number;
  /** Additional right-hand cell on the same baseline (e.g. a mark glyph). */
  right?: string;
  /** Left side-box cell on the same baseline (LMS info panel). */
  side?: string;
}

export function page(pageNumber: number, specs: (LineSpec | string)[], opts: { images?: { y: number; h: number }[]; source?: "TEXT_LAYER" | "OCR"; conf?: number } = {}): PageInput {
  const items: RawTextItem[] = [];
  let y = 40;
  const H = 11;
  for (const raw of specs) {
    const s: LineSpec = typeof raw === "string" ? { text: raw } : raw;
    y += s.gap ?? 0;
    const x = s.x ?? 160;
    if (s.side) items.push({ str: s.side, x: 30, y, w: s.side.length * 4, h: H, conf: opts.conf });
    if (s.text) items.push({ str: s.text, x, y, w: s.text.length * 5.2, h: H, conf: opts.conf });
    if (s.right) items.push({ str: s.right, x: 520, y, w: 8, h: H, conf: opts.conf });
    y += 16;
  }
  // Running footer (should be filtered as noise across pages)
  items.push({ str: `https://lms.example.edu/mod/quiz/review.php?attempt=1234`, x: 30, y: 800, w: 300, h: 8 });
  items.push({ str: `${pageNumber}/${99}`, x: 540, y: 800, w: 20, h: 8 });
  return {
    pageNumber,
    width: 595,
    height: 842,
    source: opts.source ?? "TEXT_LAYER",
    items,
    images: (opts.images ?? []).map((im) => ({ bbox: { x: 120, y: im.y, w: 200, h: im.h } })),
    ocrConfidence: opts.conf,
    textLayerChars: items.reduce((s, i) => s + i.str.length, 0),
  };
}

const CHECK = "\uF00C"; // private-use icon glyph used by the LMS for "correct"
const CROSS = "\uF00D"; // private-use icon glyph used by the LMS for "incorrect"

/** Moodle-like export: 2 attempts, PUA icons, scores, side-box, cross-page question. */
export function moodleExport(): PageInput[] {
  return [
    page(1, [
      { text: "Нормальная физиология. Кровь. Итоговый тест" },
      { text: "Тест начат  четверг, 3 октября 2024, 10:00" },
      { text: "Состояние  Завершено" },
      { text: "Баллы  3,50/5,00" },
      { side: "Вопрос 1", text: "Белками, регулирующими агрегатное состояние крови, являются:", gap: 10 },
      { side: "Верно", text: "Выберите один ответ:" },
      { side: "Баллов: 1,00 из 1,00", text: "a. альбумины" },
      { text: "b. фибриноген", right: CHECK },
      { text: "c. гамма-глобулины" },
      { side: "Вопрос 2", text: "Какие клетки участвуют в гемостазе?", gap: 10 },
      { side: "Частично правильный", text: "Выберите один или несколько ответов:" },
      { side: "Баллов: 0,50 из 1,00", text: "a. тромбоциты", right: CHECK },
      { text: "b. эритроциты" },
      { text: "c. эндотелиоциты" },
      { side: "Вопрос 3", text: "Основная функция эритроцитов:", gap: 10 },
      { side: "Неверно", text: "Выберите один ответ:" },
      { side: "Баллов: 0,00 из 1,00", text: "a. транспорт газов" },
      { text: "b. фагоцитоз", right: CROSS },
      { text: "c. выработка антител" },
    ]),
    page(2, [
      { side: "Вопрос 4", text: "Укажите нормальное содержание гемоглобина у мужчин, а также" },
      { side: "Верно", text: "единицы его измерения в клинической практике" },
      { side: "Баллов: 1,00 из 1,00", text: "Выберите один ответ:" },
      { text: "a. 130–160 г/л", right: CHECK },
      { text: "b. 90–110 г/л" },
    ]),
    page(3, [
      { text: "c. 200–250 г/л" },
      { text: "d. 50–70 г/л" },
      { side: "Вопрос 5", text: "Основная функция эритроцитов:", gap: 10 },
      { side: "Неверно", text: "Выберите один ответ:" },
      { side: "Баллов: 0,00 из 1,00", text: "a. выработка антител", right: CROSS },
      { text: "b. фагоцитоз" },
      { text: "c. транспорт газов" },
      { text: "Тест начат  пятница, 4 октября 2024, 11:00", gap: 30 },
      { text: "Состояние  Завершено" },
      { text: "Баллы  4,00/5,00" },
      { side: "Вопрос 1", text: "Белками, регулирующими агрегатное состояние крови, являются:", gap: 10 },
      { side: "Верно", text: "Выберите один ответ:" },
      { side: "Баллов: 1,00 из 1,00", text: "a. гамма-глобулины" },
      { text: "b. альбумины" },
      { text: "c. фибриноген", right: CHECK },
    ]),
    page(4, [
      { side: "Вопрос 2", text: "Какие клетки участвуют в гемостазе?" },
      { side: "Верно", text: "Выберите один или несколько ответов:" },
      { side: "Баллов: 1,00 из 1,00", text: "a. эритроциты" },
      { text: "b. тромбоциты", right: CHECK },
      { text: "c. эндотелиоциты", right: CHECK },
      { side: "Вопрос 3", text: "Основная функция эритроцитов:", gap: 10 },
      { side: "Верно", text: "Выберите один ответ:" },
      { side: "Баллов: 1,00 из 1,00", text: "a. фагоцитоз" },
      { text: "b. транспорт газов", right: CHECK },
      { text: "c. выработка антител" },
    ]),
  ];
}

/** Bank with explicit +{00}/-{00} marks, no headers. */
export function plusMinusBank(): PageInput[] {
  return [
    page(1, [
      { text: "Белками, регулирующими агрегатное состояние крови, являются:" },
      { text: "-{00} альбумины" },
      { text: "+{00} фибриноген" },
      { text: "-{00} гамма-глобулины" },
      { text: "Какие ионы необходимы для свертывания крови?", gap: 12, x: 120 },
      { text: "+{00} ионы кальция" },
      { text: "-{00} ионы натрия" },
      { text: "-{00} ионы калия" },
      { text: "Выберите все форменные элементы крови:", gap: 12 },
      { text: "+{00} эритроциты" },
      { text: "+{00} тромбоциты" },
      { text: "-{00} фибробласты" },
    ]),
  ];
}

/** Numbered list with feedback lines and ordering by [NN] codes. */
export function numberedWithFeedback(): PageInput[] {
  return [
    page(1, [
      { text: "1. Что из перечисленного относится к костям мозгового черепа?" },
      { text: "а) лобная кость" },
      { text: "б) верхняя челюсть" },
      { text: "в) скуловая кость" },
      { text: "Правильный ответ: лобная кость" },
      { text: "2. Расположите отделы позвоночника в правильном порядке сверху вниз:", gap: 10 },
      { text: "[03] поясничный" },
      { text: "[01] шейный" },
      { text: "[02] грудной" },
      { text: "[04] крестцовый" },
      { text: "3. Что обозначено цифрой 17 на рисунке?", gap: 10 },
    ], { images: [{ y: 300, h: 120 }] }),
    page(2, [
      { text: "а) лучевая кость" },
      { text: "б) локтевая кость" },
      { text: "4. Длина волны ультразвука в мягких тканях при частоте 1 МГц составляет:", gap: 10 },
      { text: "а) 1,5·10⁻³ м" },
      { text: "б) 1,5·10⁻⁶ м" },
      { text: "в) 15 м" },
      { text: "Правильный ответ: 1,5·10⁻³ м" },
    ]),
  ];
}
