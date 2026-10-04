import type { ClassifiedLine, LayoutLine, LineRole } from "./types";
import { CHECK_GLYPHS, CROSS_GLYPHS, isPrivateUseGlyph, parseLocaleNumber, stripMarkGlyphs } from "./text";
import { noiseKey } from "./layout";

/**
 * Line classifier. Each rule is a cue with a weight; a line gets the role
 * with the strongest cue. Regexes are only *one* signal — positional/context
 * resolution happens in the segmenter, which can override ambiguous roles
 * (e.g. "2) ..." is an option or a question depending on surroundings).
 */

export const HEADER_WORD = "(?:вопрос|question|задание|задача|питання|тестовое\\s+задание|frage|pregunta|প্রশ্ন)";

const RE = {
  headerStrong: new RegExp(`^${HEADER_WORD}\\s*№?\\s*(\\d{1,4})\\s*[.:)]?$`, "i"),
  headerInline: new RegExp(`^${HEADER_WORD}\\s*№?\\s*(\\d{1,4})\\s*[.:)\\-–—]\\s*(\\S.*)$`, "i"),
  headerHash: /^№\s*(\d{1,4})\s*[.:)]?\s*(.*)$/,
  numbered: /^(\d{1,4})\s*([.)])\s*(\S.*)$/,
  status:
    /^(верно|неверно|выполнен[оа]?|не\s+выполнен[оа]?|завершено|не\s+завершено|complete|incomplete|частично\s+правильн[а-яёa-z]*|частично\s+верн[а-яёa-z]*|нет\s+ответа|не\s+отвечено|ответ\s+сохран[её]н|не\s+оценено|correct|incorrect|partially\s+correct|not\s+answered|answer\s+saved|not\s+yet\s+answered|requires\s+grading)$/i,
  score:
    /^(?:баллов|балл|баллы|оценка|mark|marks|points?|score)\s*:?\s*(-?[\d.,]+)\s*(?:из|out\s+of|of|\/)\s*([\d.,]+)\s*(?:\(.*\))?$/i,
  scoreMaxOnly: /^(?:максимальный\s+балл|макс\.?\s*балл|marked\s+out\s+of|максимум)\s*:?\s*([\d.,]+)$/i,
  flag: /^(?:отметить\s+вопрос|flag\s+question|убрать\s+отметку|remove\s+flag|текст\s+вопроса|question\s+text|информация|information)$/i,
  attemptMeta:
    /^(тест\s+начат|начат|состояние|завершен[оa]?|затраченное\s+время|прошло\s+времени|баллы|оценка|отзыв|started\s+on|state|completed\s+on|time\s+taken|marks|grade|feedback|попытка|attempt)\s*:?\s*(.*)$/i,
  feedback:
    /^(правильн[а-яёa-z]+\s+ответ[а-яёa-z]*|верн[а-яёa-z]+\s+ответ[а-яёa-z]*|the\s+correct\s+answers?\s+(?:is|are)|correct\s+answers?|ваш\s+ответ\s+(?:не\s*)?(?:верный|правильный|частично\s+правильный)|your\s+answer\s+is\s+(?:in)?correct|your\s+answer\s+is\s+partially\s+correct|отзыв|feedback)\s*[:.]?\s*(.*)$/i,
  plusMinus: /^([+\-−–])\s*\{\s*(\d+)\s*\}\s*(.*)$/,
  bracketNum: /^\[\s*(\d{1,3})\s*\]\s*(.+)$/,
  letter: /^([a-zа-яё])\s*([.)])\s+(\S.*)$/i,
  parenLetter: /^\(\s*([a-zа-яё0-9]{1,2})\s*\)\s*(\S.*)$/i,
  bullet: /^([•●○◦▪■□☐☑☒◯⬤◉◎])\s*(\S.*)$/,
  pageCounter: /^(?:страница|стр\.|page|p\.)\s*\d+\s*(?:из|of|\/)\s*\d+$|^\d+\s*(?:из|of|\/)\s*\d+$|^-?\s*\d{1,4}\s*-?$/i,
  url: /^(?:https?:\/\/|www\.)\S+$/i,
  timestamp: /^\d{1,2}[./]\d{1,2}[./]\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?)?(?:\s*[AP]M)?$/i,
  lmsPrintHeader: /(?:просмотр\s+попытки|review\s+of\s+attempt|attempt\s+review)\s*:?\s*https?:\/\/|\/mod\/quiz\/review\.php\?|^\S.*\s+https?:\/\/\S+\.{3}$/i,
  navNoise:
    /^(?:закончить\s+обзор|finish\s+review|навигация\s+по\s+тесту|quiz\s+navigation|показать\s+одну\s+страницу|show\s+one\s+page|перейти\s+к|jump\s+to|следующая\s+страница|next\s+page|предыдущая\s+страница|previous\s+page)(?![а-яёa-z])/i,
};

/** Instruction detection by verb + object cue scoring, not by one phrase. */
const INSTR_VERBS =
  /^(выберите|выбери|укажите|отметьте|отметь|установите|расположите|упорядочите|упорядочьте|определите|введите|впишите|сопоставьте|select|choose|pick|mark|match|arrange|order|put|enter|type|identify|оберіть|вкажіть|виберіть)(?![а-яёa-z])/i;
const INSTR_OBJECTS =
  /(ответ|вариант|соответстви|последовательност|порядк|правильн|верн|one|more|answer|option|correct|order|sequence|match|following|відповід)/i;

export function isInstruction(text: string): { ok: boolean; multi: boolean | null; kind: string | null } {
  const t = text.trim();
  if (t.length > 110) return { ok: false, multi: null, kind: null };
  const verb = INSTR_VERBS.test(t);
  const obj = INSTR_OBJECTS.test(t);
  const endsColon = /[:：]$/.test(t);
  const score = (verb ? 2 : 0) + (obj ? 1.5 : 0) + (endsColon ? 0.5 : 0);
  if (score < 3) return { ok: false, multi: null, kind: null };

  let multi: boolean | null = null;
  if (/(один\s+или\s+несколько|одн[а-яёa-z]*\s+или\s+более|несколько|все\s+правильн|все\s+верн|one\s+or\s+more|all\s+that\s+apply|multiple|кілька|декілька)/i.test(t)) multi = true;
  else if (/(один\s+(?:правильн[а-яёa-z]*\s+)?(?:ответ|вариант)|одн[а-яёa-z]+\s+(?:правильн|верн)[а-яёa-z]*|select\s+one|choose\s+one|single|одну\s+відповідь|один\s+варіант)/i.test(t)) multi = false;

  let kind: string | null = null;
  if (/(соответстви|сопостав|match)/i.test(t)) kind = "MATCHING";
  else if (/(последовательност|порядк|упорядоч|arrange|order|sequence|расположите)/i.test(t)) kind = "ORDERING";
  else if (/(введите|впишите|enter|type)(?![а-яёa-z])/i.test(t)) kind = "TEXT";
  return { ok: true, multi, kind };
}

export interface OptionMeta {
  kind: "LETTER" | "NUMBER" | "PLUS_MINUS" | "BRACKET" | "BULLET" | "GLYPH_ONLY";
  label: string | null;
  number: number | null;
  sign: "+" | "-" | null;
  code: string | null;
  text: string;
  glyphs: string[];
  bulletGlyph: string | null;
}

function glyphOnly(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t) return false;
  for (const ch of t) {
    if (!(CHECK_GLYPHS.includes(ch) || CROSS_GLYPHS.includes(ch) || isPrivateUseGlyph(ch))) return false;
  }
  return true;
}

export function parseOptionLine(text: string): OptionMeta | null {
  const raw = text.trim();
  // Leading glyphs (icons printed before the label) are preserved as marks.
  const { text: noGlyph, glyphs } = stripMarkGlyphs(raw);

  let m = noGlyph.match(RE.plusMinus);
  if (m) {
    return { kind: "PLUS_MINUS", label: null, number: null, sign: m[1] === "+" ? "+" : "-", code: m[2], text: m[3].trim(), glyphs, bulletGlyph: null };
  }
  m = noGlyph.match(RE.bracketNum);
  if (m) {
    return { kind: "BRACKET", label: m[1], number: Number(m[1]), sign: null, code: m[1], text: m[2].trim(), glyphs, bulletGlyph: null };
  }
  m = noGlyph.match(RE.bullet);
  if (m) {
    // "■ a. Text": checkbox before a lettered label keeps the label and records the box state.
    const inner = RE.bullet.test(m[2]) ? null : parseOptionLine(m[2]);
    if (inner && inner.kind !== "BULLET") return { ...inner, glyphs: [...glyphs, ...inner.glyphs], bulletGlyph: m[1] };
    return { kind: "BULLET", label: null, number: null, sign: null, code: null, text: m[2].trim(), glyphs, bulletGlyph: m[1] };
  }
  m = noGlyph.match(RE.parenLetter);
  if (m) {
    const isNum = /^\d+$/.test(m[1]);
    return { kind: isNum ? "NUMBER" : "LETTER", label: m[1], number: isNum ? Number(m[1]) : null, sign: null, code: null, text: m[2].trim(), glyphs, bulletGlyph: null };
  }
  m = noGlyph.match(RE.letter);
  if (m) {
    return { kind: "LETTER", label: m[1], number: null, sign: null, code: null, text: m[3].trim(), glyphs, bulletGlyph: null };
  }
  m = noGlyph.match(RE.numbered);
  if (m) {
    return { kind: "NUMBER", label: m[1], number: Number(m[1]), sign: null, code: null, text: m[3].trim(), glyphs, bulletGlyph: null };
  }
  return null;
}

export interface ClassifyContext {
  runningNoise: Set<string>;
}

export function classifyLine(line: LayoutLine, ctx: ClassifyContext): ClassifiedLine {
  const t = line.text.trim();
  const with_ = (role: LineRole, meta?: Record<string, unknown>): ClassifiedLine => ({ ...line, role, meta });

  if (!t) return with_("NOISE", { reason: "empty" });
  const structural =
    RE.headerStrong.test(t) || RE.headerInline.test(t) || RE.status.test(t) || RE.score.test(t) || isInstruction(t).ok || parseOptionLine(t) !== null;
  if (!structural && ctx.runningNoise.has(noiseKey(t))) return with_("NOISE", { reason: "running-header-footer" });
  if (RE.lmsPrintHeader.test(t)) return with_("NOISE", { reason: "page-chrome" });
  const isChrome = (s: string) =>
    RE.pageCounter.test(s) || RE.url.test(s) || RE.timestamp.test(s) || RE.navNoise.test(s) || RE.lmsPrintHeader.test(s);
  if (isChrome(t)) return with_("NOISE", { reason: "page-chrome" });
  // Print footers often combine URL + page counter + date on one baseline.
  const parts = (line.cells && line.cells.length > 1 ? line.cells.map((c) => c.text) : t.split(/\s{2,}|\s+(?=https?:\/\/)|(?<=\S)\s+(?=\d+\s*(?:из|of|\/)\s*\d+$)/))
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1 && parts.every(isChrome)) return with_("NOISE", { reason: "page-chrome" });
  if (glyphOnly(t)) return with_("MARK_ONLY", { glyphs: [...t.replace(/\s+/g, "")] });

  let m = t.match(RE.headerStrong);
  if (m) return with_("QUESTION_HEADER", { number: Number(m[1]), inline: null, strength: "strong" });
  m = t.match(RE.headerInline);
  if (m) return with_("QUESTION_HEADER", { number: Number(m[1]), inline: m[2], strength: "strong" });
  m = t.match(RE.headerHash);
  if (m) return with_("QUESTION_HEADER", { number: Number(m[1]), inline: m[2] || null, strength: "medium" });

  if (RE.status.test(t)) return with_("STATUS", { value: t.toLowerCase() });

  // Attempt summary rows ("Баллы 3,50/5,00", "Оценка 7,00 из 10,00 (70%)") use no colon.
  m = t.match(/^(баллы|marks|оценка|grade)\s+([\d.,]+\s*(?:\/|из|out\s+of)\s*[\d.,]+.*)$/i);
  if (m) return with_("ATTEMPT_META", { key: m[1].toLowerCase(), value: m[2] });

  m = t.match(RE.score);
  if (m) {
    return with_("SCORE", { earned: parseLocaleNumber(m[1]), max: parseLocaleNumber(m[2]), raw: t });
  }
  m = t.match(RE.scoreMaxOnly);
  if (m) return with_("SCORE", { earned: null, max: parseLocaleNumber(m[1]), raw: t });

  if (RE.flag.test(t)) return with_("FLAG");

  m = t.match(RE.feedback);
  if (m && !/^(отзыв|feedback)$/i.test(m[1]) ) {
    return with_("FEEDBACK", { key: m[1].toLowerCase(), value: m[2] ?? "" });
  }

  m = t.match(RE.attemptMeta);
  if (m && (m[2] || /^(тест\s+начат|started\s+on)$/i.test(m[1]))) {
    // "Баллы 604,00/626,00" / "Оценка 8,33 из 10,00 (83%)" → attempt-level
    const key = m[1].toLowerCase();
    const strongKeys = /^(тест\s+начат|started\s+on|состояние|state|завершен|completed\s+on|затраченное\s+время|прошло\s+времени|time\s+taken)/i;
    const scoreKeys = /^(баллы|marks|оценка|grade)$/i;
    if (strongKeys.test(key) || (scoreKeys.test(key) && /[\d.,]+\s*(?:\/|из|out\s+of)\s*[\d.,]+/i.test(m[2]))) {
      return with_("ATTEMPT_META", { key, value: m[2] ?? "" });
    }
  }

  const instr = isInstruction(t);
  if (instr.ok) return with_("INSTRUCTION", { multi: instr.multi, kind: instr.kind });

  const opt = parseOptionLine(t);
  // Numbered lines ("2. ...") stay OPTION/kind=NUMBER here; the segmenter
  // decides from context whether they start a new question.
  if (opt) return with_("OPTION", opt as unknown as Record<string, unknown>);

  return with_("TEXT");
}

export function parseScoreText(raw: string): { earned: number | null; max: number | null } | null {
  const m = raw.trim().match(RE.score);
  if (!m) return null;
  return { earned: parseLocaleNumber(m[1]), max: parseLocaleNumber(m[2]) };
}
