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

test("repeated answer letter moves to the case-variant twin option", () => {
  const r = repairQuestion(q("На эритроцитах Rh-отрицательной крови могут находиться антигены:", [["A", "С"], ["B", "D"], ["C", "E"], ["D", "с"]], { key: "A,A,C", text: "С; С; E" }));
  assert.equal(r.answer?.key, "A,D,C");
  assert.equal(r.answer?.text, "С; с; E");
});

test("an option's wrapped tail after the stem's colon goes back to that option", () => {
  const r = repairQuestion(
    q(
      "При электротравме в первую очередь необходимо: невозможности обесточивания установки",
      [["A", "отделить пострадавшего при помощи диэлектрика в случае"], ["B", "проверить наличие дыхания"]],
      { key: "A", text: "отделить пострадавшего при помощи диэлектрика в случае" },
    ),
  );
  assert.equal(r.question.text, "При электротравме в первую очередь необходимо:");
  assert.equal(r.options[0].text, "отделить пострадавшего при помощи диэлектрика в случае невозможности обесточивания установки");
  assert.equal(r.answer?.text, r.options[0].text);
});

test("data after a colon stays in the stem when no option is cut off", () => {
  const stem = "Оцените показатели (мужчина): эритроциты 4.7×10 12 /л, гемоглобин 142 г/л";
  const r = repairQuestion(q(stem, [["A", "все показатели в норме"], ["B", "снижен гемоглобин"]], { key: "A", text: "все показатели в норме" }));
  assert.equal(r.question.text, stem);
});

test("stemless one-row ordering becomes a short-answer question", () => {
  const src = { ...q("", [["A", "В состав шейного отдела симпатического ствола входит узла (цифрой)"]], { key: "", text: "3) …" }), sequence: { A: 3 }, tags: ["ordering"] };
  const r = repairQuestion(src as StructuredQuestion);
  assert.equal(r.question.text, "В состав шейного отдела симпатического ствола входит узла (цифрой)");
  assert.equal(r.options.length, 0);
  assert.equal(r.answer?.text, "3");
});

test("broken multiply sign is restored", () => {
  const r = repairQuestion(q("Анемия:", [["A", "2,6ЧЧ10 12 /л"], ["B", "3,7×10 12 /л"]], { key: "A", text: "2,6ЧЧ10 12 /л" }));
  assert.equal(r.options[0].text, "2,6×10 12 /л");
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
