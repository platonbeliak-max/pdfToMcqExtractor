import assert from "node:assert/strict";
import type { AnswerOption, QuestionInstance } from "../../src/lib/ingestion/types";
import { normalizeForMatch } from "../../src/lib/ingestion/text";
import {
  isHeadingStem,
  normalizeBlanks,
  repairSequence,
  repairStemAndOptions,
  splitFilledAnswer,
  stripScreenshotNoise,
} from "../../src/lib/ingestion/repair";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

let n = 0;
const opt = (label: string | null, text: string): AnswerOption => ({
  id: `o${++n}`, label, position: 0, rawText: text, text, normalizedText: normalizeForMatch(text), page: 1, bbox: null, pairText: null, orderIndex: null,
});
const texts = (os: AnswerOption[]) => os.map((o) => `${o.label}:${o.text}`);

console.log("Screenshot noise");
test("status bar after the text is cut", () =>
  assert.equal(stripScreenshotNoise("Трубка для трахеостомии называется канюля люэра в ответе указать эпоним Ко 16:24 2 „ий! 36 (4D чоауеоодиаемл ам AVISASANDIVI пукаэапитм"), "Трубка для трахеостомии называется канюля люэра в ответе указать эпоним"));
test("address bar + status bar after an option", () =>
  assert.equal(stripScreenshotNoise("Проводится в кратчайшие сроки после начала заболевания & etest.bsmu.by CJ] 16:24 2 ull 36 ($) = eee"), "Проводится в кратчайшие сроки после начала заболевания"));
test("stray + | symbols", () =>
  assert.equal(stripScreenshotNoise("Заднюю поверхность глотки покрывает щечно-глоточная + |фасция, которая ограничивает позадиглоточное 16:24 2 „и! 36 ($)"), "Заднюю поверхность глотки покрывает щечно-глоточная фасция, которая ограничивает позадиглоточное"));
test("normal ratio 1:10 is kept", () => assert.equal(stripScreenshotNoise("Разведение 1:10 даёт раствор"), "Разведение 1:10 даёт раствор"));

console.log("Glued labels");
test("d. + e. glued by radio-button junk", () => {
  const r = repairStemAndOptions("Срочная операция", [opt("a", "Устраняет симптомы"), opt("b", "Проводится в кратчайшие сроки"), opt("c", "Проводится по жизненным показаниям"), opt("d", "Облегчает состояние пациента е е. Выполняется после уточнения клинического диагноза")], 1);
  assert.deepEqual(texts(r.options), ["a:Устраняет симптомы", "b:Проводится в кратчайшие сроки", "c:Проводится по жизненным показаниям", "d:Облегчает состояние пациента", "e:Выполняется после уточнения клинического диагноза"]);
});
test("b. glued into option a", () => {
  const r = repairStemAndOptions("Укажите самое узкое место полости гортани", [opt("a", "Место перехода гортани в трахею е b. Голосовая щель"), opt("c", "Подголосовая полость"), opt("d", "Вход в гортань"), opt("e", "Преддверие гортани")], 1);
  assert.deepEqual(texts(r.options), ["a:Место перехода гортани в трахею", "b:Голосовая щель", "c:Подголосовая полость", "d:Вход в гортань", "e:Преддверие гортани"]);
});
test("« d. glued into option c", () => {
  const r = repairStemAndOptions("Какая из ветвей IX нерва", [opt("a", "Миндаликовые ветви"), opt("b", "Синусная ветвь"), opt("c", "Глоточные ветви « d. Барабанный нерв"), opt("e", "Язычные ветви")], 1);
  assert.deepEqual(texts(r.options), ["a:Миндаликовые ветви", "b:Синусная ветвь", "c:Глоточные ветви", "d:Барабанный нерв", "e:Язычные ветви"]);
});
test("trailing | removed from option", () => {
  const r = repairStemAndOptions("Вопрос про блокаду", [opt("a", "С целью местной десимпатизации |"), opt("b", "Асфиксия")], 1);
  assert.equal(r.options[0].text, "С целью местной десимпатизации");
});
test("option a printed inside the stem", () => {
  const r = repairStemAndOptions("Укажите, с какой целью производится вагосимпатическая блокада? v a. С целью купирования плевропульмонального шока", [opt("b", "С целью предупреждения смещения средостения"), opt("c", "Асфиксия")], 1);
  assert.equal(r.stem, "Укажите, с какой целью производится вагосимпатическая блокада?");
  assert.deepEqual(texts(r.options), ["a:С целью купирования плевропульмонального шока", "b:С целью предупреждения смещения средостения", "c:Асфиксия"]);
});
test("a normal question is left alone", () => {
  const r = repairStemAndOptions("Что такое флегмона?", [opt("a", "Гнойное воспаление"), opt("b", "Серозное воспаление")], 1);
  assert.equal(r.stem, "Что такое флегмона?");
  assert.deepEqual(texts(r.options), ["a:Гнойное воспаление", "b:Серозное воспаление"]);
});
test("витамин D. inside option c is not split without need", () => {
  const r = repairStemAndOptions("Что нужно?", [opt("a", "Витамин А"), opt("b", "Витамин Е"), opt("c", "Витамин Д")], 1);
  assert.equal(r.options.length, 3);
});

console.log("Answer typed into the stem");
test("answer after the question mark", () => {
  const r = splitFilledAnswer("Какие черепные нервы составляют «группу вагуса»? Блуждающий нерв, барабанный нерв, диафрагмальный нерв (название нервов в алфавитном порядке).");
  assert.ok(r);
  assert.equal(r!.stem, "Какие черепные нервы составляют «группу вагуса»? _____ (название нервов в алфавитном порядке)");
  assert.equal(r!.answer, "Блуждающий нерв, барабанный нерв, диафрагмальный нерв");
});
test("answer after «называется»", () => {
  const r = splitFilledAnswer("Трубка для трахеостомии называется канюля люэра в ответе указать эпоним");
  assert.ok(r);
  assert.equal(r!.stem, "Трубка для трахеостомии называется _____ (в ответе указать эпоним)");
  assert.equal(r!.answer, "канюля люэра");
});
test("ordinary question is untouched", () => assert.equal(splitFilledAnswer("Какие фасции имеются в области лопаточно-ключичного треугольника?"), null));
test("empty boxes become blanks", () =>
  assert.equal(normalizeBlanks("мышцу покрывает поверхностная □ пластинка шейной □ фасции"), "мышцу покрывает поверхностная _____ пластинка шейной _____ фасции"));

console.log("Headings");
test("textbook title is a heading", () => assert.ok(isHeadingStem("Топографическая анатомия и оперативная хирургия")));
test("question is not a heading", () => assert.ok(!isHeadingStem("Что такое флегмона?")));
test("sentence with a verb is not a heading", () => assert.ok(!isHeadingStem("Стенка трахеи образована замкнутыми хрящевыми кольцами")));

console.log("Page overlap");
const inst = (id: string, stem: string, options: AnswerOption[]): QuestionInstance =>
  ({ id, stem, normalizedStem: normalizeForMatch(stem), options, visualMarks: [] } as unknown as QuestionInstance);
test("options leaked from the previous screenshot are removed", () => {
  const q252 = inst("q252", "Укажите самое узкое место полости гортани", [opt("a", "Голосовая щель"), opt("b", "Подголосовая полость"), opt("c", "Вход в гортань"), opt("d", "Преддверие гортани")]);
  const q253 = inst("q253", "Заднюю поверхность глотки покрывает щечно-глоточная фасция, которая ограничивает позадиглоточное", [opt("a", "Вход в гортань"), opt("b", "Преддверие гортани")]);
  const out = repairSequence([q252, q253]);
  assert.equal(out[1].options.length, 0);
});
test("cut-off copy of a question is dropped", () => {
  const q248 = inst("q248", "Что такое флегмона?", [opt("a", "Псевдомембранозный воспалительный")]);
  const q249 = inst("q249", "Что такое флегмона?", [opt("a", "Псевдомембранозный воспалительный процесс"), opt("b", "Фибринозный воспалительный процесс"), opt("c", "Ограниченный гнойный воспалительный процесс")]);
  const out = repairSequence([q248, q249]);
  assert.deepEqual(out.map((q) => q.id), ["q249"]);
});
test("truncated stem before the full one is dropped", () => {
  const q250 = inst("q250", "Укажите, с какой целью производится", []);
  const q251 = inst("q251", "Укажите, с какой целью производится вагосимпатическая блокада?", [opt("a", "С целью предупреждения смещения"), opt("b", "Асфиксия")]);
  const out = repairSequence([q250, q251]);
  assert.deepEqual(out.map((q) => q.id), ["q251"]);
});
test("true/false neighbours are not touched", () => {
  const a = inst("a", "Стенка трахеи образована замкнутыми хрящевыми кольцами", [opt("a", "Верно"), opt("b", "Неверно")]);
  const b = inst("b", "Внутренняя сонная артерия отдает ветви только в полости черепа", [opt("a", "Верно"), opt("b", "Неверно")]);
  assert.equal(repairSequence([a, b])[1].options.length, 2);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
