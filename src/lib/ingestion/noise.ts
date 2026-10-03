// OCR often swaps Cyrillic letters for Latin lookalikes ("Бaлл", "6алл"), so each letter accepts both.
const SCORE_WORD = "[бБ6][аaАA][лЛ][лЛ](?:[оo]в|ы)?|[оo]ценка|marks?|points?|score|mark";
const NUM = "-?\\d+(?:[.,]\\d+)?";
const SCORE_RE = new RegExp(
  `(?:^|[\\s|(\\[])(?:${SCORE_WORD})\\s*[:;.]?\\s*${NUM}(?:\\s*(?:из|out\\s+of|of|\\/)\\s*${NUM})?`,
  "gi",
);
const MOODLE_UI_RE =
  /(?:^|\s)(?:Отметить вопрос|Текст вопроса|Flag question|Question text|Выберите (?:один|одн[иу]|несколько) (?:или несколько )?(?:ответ(?:ов|а)?|вариант(?:ов|а)?)\s*:?|Select one or more\s*:?|Select one\s*:?)(?=\s|$)/gi;

/** Removes Moodle score fragments ("Балл: 1,00", "Баллов: 1,00 из 1,00") and UI labels that leak into text. */
export function stripScoreNoise(text: string): string {
  return text.replace(SCORE_RE, " ").replace(MOODLE_UI_RE, " ").replace(/\s{2,}/g, " ").trim();
}
