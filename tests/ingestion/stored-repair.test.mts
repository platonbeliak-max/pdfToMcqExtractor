import assert from "node:assert/strict";
import type { StructuredQuestion } from "../../src/types/question";
import { fixMojibake, pruneBank, repairQuestion, stripPrintFooter } from "../../src/lib/stored-repair";

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
const q = (text: string, options: [string, string][], answer: { key?: string; text?: string } | null): StructuredQuestion =>
  ({
    _id: `q${++n}`,
    id: `q${n}`,
    questionNumber: n,
    question: { text },
    options: options.map(([key, t]) => ({ key, text: t })),
    answer: answer ? { key: answer.key ?? "", text: answer.text ?? "" } : null,
    source: { documentId: "d", documentName: "d.pdf", pageNumber: 1 },
    confidence: { question: 1, options: 1, answer: 1, overall: 1, level: "high" },
    status: "verified",
    category: "General",
    tags: [],
    createdAt: "",
    updatedAt: "",
  }) as unknown as StructuredQuestion;

test("cp1251 mojibake is decoded", () => {
  assert.equal(fixMojibake("Ãðóäèíî-ùèòîâèäíàÿ ìûøöà"), "Грудино-щитовидная мышца");
});

test("etest print footer is stripped", () => {
  assert.equal(stripPrintFooter("желобоватый зонд https://etest.bsmu.by/mod/quiz/review.php?attempt=1 5/12 03.10.2022, 16:03 Стр. 5 из 12"), "желобоватый зонд");
});

test("Moodle check-mark icon glyph is removed from typed answers", () => {
  const r = repairQuestion(q("Рассчитайте среднее давление", [], { text: "93 \uF00C" }));
  assert.equal(r.answer?.text, "93");
});

test("true/false option glued to the stem is split back out", () => {
  const r = repairQuestion(q("Стенка трахеи образована замкнутыми хрящевыми кольцами Верно", [["A", "Неверно"]], { key: "A", text: "Неверно" }));
  assert.equal(r.question.text, "Стенка трахеи образована замкнутыми хрящевыми кольцами");
  assert.deepEqual(r.options.map((o) => o.text), ["Верно", "Неверно"]);
  assert.equal(r.answer?.key, "B");
});

test("adjacent blanks collapse when the answer is one phrase", () => {
  const r = repairQuestion(q("Укажите место начала правой общей сонной артерии ___ ___", [], { text: "плечеголовной ствол" }));
  assert.equal(r.question.text, "Укажите место начала правой общей сонной артерии ___");
});

test("blanks that already fit the answer are left alone", () => {
  const r = repairQuestion(q("Сонным бугорком называется ___ бугорок ___ отростка С6.", [], { text: "«передний» «поперечного»" }));
  assert.equal(r.question.text, "Сонным бугорком называется ___ бугорок ___ отростка С6.");
});

test("attempt with the student's words in place of blanks is dropped next to the cloze", () => {
  const out = pruneBank([
    q("Сонным бугорком называется ___ бугорок ___ отростка С6.", [], { text: "«передний» «поперечного»" }),
    q("Сонным бугорком называется поперечный бугорок шейного отростка С6.", [], { text: "передний поперечного" }),
  ]);
  assert.equal(out.length, 1);
  assert.match(out[0].question.text, /___/);
});

test("phone-screenshot OCR blob is dropped", () => {
  const out = pruneBank([q("\\ Срочная операция а. Устраняет симптомы b. Проводится & etest.bsmu.by CJ] 16:24 2 ull 36 ($)", [], { text: "x" })]);
  assert.equal(out.length, 0);
});

test("answer that only repeats the question no longer counts as an answer", () => {
  const [r] = pruneBank([q("Язычная артерия является ветвью наружной сонной артерии", [], { text: "Язычная артерия является ветвью наружной сонной артерии" })]);
  assert.equal(r.answer?.text, "");
});

test("ordinary multiple-choice question passes through untouched", () => {
  const src = q("Шейное сплетение образуют:", [["A", "Передние ветви С1-С4"], ["B", "Задние ветви С1-С4"]], { key: "A", text: "Передние ветви С1-С4" });
  const [r] = pruneBank([repairQuestion(src)]);
  assert.deepEqual(r.options, src.options);
  assert.equal(r.answer?.key, "A");
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
