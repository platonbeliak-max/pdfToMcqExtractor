import assert from "node:assert/strict";
import { analyzeDocument } from "../../src/lib/ingestion/pipeline";
import { aggregate } from "../../src/lib/ingestion/canonical";
import { moodleExport, numberedWithFeedback, plusMinusBank } from "./fixtures";

let counter = 0;
const key = () => `k${++counter}`;
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

const optText = (q: { options: { id: string; text: string }[] }, ids: string[]) =>
  q.options.filter((o) => ids.includes(o.id)).map((o) => o.text).sort();

console.log("Moodle export");
{
  const a = analyzeDocument(moodleExport(), { documentId: "doc-moodle" });
  const qs = a.instances;

  test("detects source type MOODLE_EXPORT", () => assert.equal(a.profile.sourceType, "MOODLE_EXPORT"));
  test("detects 2 attempts", () => assert.equal(a.attempts.length, 2));
  test("finds 8 question instances (5 + 3)", () => assert.equal(qs.length, 8));
  test("attempt sizes 5 and 3", () => assert.deepEqual(a.attempts.map((x) => x.questionCount), [5, 3]));
  test("attempt score parsed", () => assert.equal(a.attempts[0].scoreMax, 5));
  test("header text never leaks into stem", () => assert.ok(qs.every((q) => !/вопрос\s*\d/i.test(q.stem) && !/баллов/i.test(q.stem))));
  test("Q1 stem is exact", () => assert.equal(qs[0].stem, "Белками, регулирующими агрегатное состояние крови, являются:"));
  test("Q1 has 3 options with glyphs stripped", () => assert.deepEqual(qs[0].options.map((o) => o.text), ["альбумины", "фибриноген", "гамма-глобулины"]));
  test("PUA glyph learned as checkmark → Q1 answer фибриноген", () => assert.deepEqual(optText(qs[0], qs[0].answer.correctOptionIds), ["фибриноген"]));
  test("Q1 confirmed by score", () => assert.equal(qs[0].answer.status, "CONFIRMED_BY_SCORE"));
  test("Q2 multiple choice", () => assert.equal(qs[1].questionType, "MULTIPLE_CHOICE"));
  test("Q2 partial score is NOT complete", () => {
    assert.equal(qs[1].score?.kind, "PARTIAL_SCORE");
    assert.equal(qs[1].answer.complete, false);
  });
  test("Q3 zero score: selected фибриноз... marked incorrect, unresolved", () => {
    assert.deepEqual(optText(qs[2], qs[2].answer.incorrectOptionIds), ["фагоцитоз"]);
    assert.notEqual(qs[2].answer.status, "CONFIRMED_BY_SCORE");
  });
  test("Q4 spans pages 2–3 and keeps all 4 options", () => {
    assert.deepEqual(qs[3].pages, [2, 3]);
    assert.equal(qs[3].options.length, 4);
    assert.ok(qs[3].stem.includes("единицы его измерения"));
  });
  test("running footer filtered as noise", () => assert.ok(a.audit.noiseLines >= 4));
  test("audit balanced and complete", () => {
    assert.ok(a.audit.balanced);
    assert.equal(a.audit.orphanLines, 0, a.audit.problems.join("; "));
  });
  test("subject detected as physiology", () => assert.equal(a.profile.detectedSubject?.slug, "physiology"));

  console.log("Moodle aggregation");
  const agg = aggregate(qs, [], key);
  test("8 instances → 4 canonical questions (Q3/Q5 same text)", () => assert.equal(agg.canonicals.length, 4));
  const blood = agg.canonicals.find((c) => c.stem.startsWith("Белками"))!;
  test("option order differs but merged; фибриноген correct, multi-attempt", () => {
    assert.equal(blood.instanceIds.length, 2);
    assert.deepEqual(blood.options.filter((o) => blood.correctKeys.includes(o.key)).map((o) => o.text), ["фибриноген"]);
    assert.equal(blood.answerStatus, "CONFIRMED_BY_MULTIPLE_ATTEMPTS");
  });
  const hemo = agg.canonicals.find((c) => c.stem.startsWith("Какие клетки"))!;
  test("partial + full attempts → complete set {тромбоциты, эндотелиоциты}", () => {
    assert.deepEqual(hemo.options.filter((o) => hemo.correctKeys.includes(o.key)).map((o) => o.text).sort(), ["тромбоциты", "эндотелиоциты"]);
    assert.equal(hemo.conflicts.length, 0);
  });
  const ery = agg.canonicals.find((c) => c.stem.startsWith("Основная функция"))!;
  test("3 attempts of erythrocyte question: транспорт газов confirmed", () => {
    assert.equal(ery.instanceIds.length, 3);
    assert.deepEqual(ery.options.filter((o) => ery.correctKeys.includes(o.key)).map((o) => o.text), ["транспорт газов"]);
  });
}

console.log("Plus/minus bank");
{
  const a = analyzeDocument(plusMinusBank(), { documentId: "doc-pm" });
  test("source type PLUS_MINUS_BANK", () => assert.equal(a.profile.sourceType, "PLUS_MINUS_BANK"));
  test("3 headerless questions", () => assert.equal(a.instances.length, 3));
  test("+{00} → EXPLICIT_TEXT_MARK, confirmed by document", () => {
    const q = a.instances[0];
    assert.equal(q.answer.status, "CONFIRMED_BY_DOCUMENT");
    assert.deepEqual(optText(q, q.answer.correctOptionIds), ["фибриноген"]);
    assert.ok(q.evidence.some((e) => e.type === "EXPLICIT_TEXT_MARK" && e.rawValue === "+{00}"));
  });
  test("marker removed from option text", () => assert.ok(a.instances.every((q) => q.options.every((o) => !/[+-]\{/.test(o.text)))));
  test("two + marks → MULTIPLE_CHOICE", () => assert.equal(a.instances[2].questionType, "MULTIPLE_CHOICE"));
}

console.log("Numbered list with feedback / ordering / image / formulas");
{
  const a = analyzeDocument(numberedWithFeedback(), { documentId: "doc-num" });
  const qs = a.instances;
  test("4 questions", () => assert.equal(qs.length, 4, qs.map((q) => q.stem).join(" | ")));
  test("feedback text → confirmed by document", () => {
    assert.equal(qs[0].answer.status, "CONFIRMED_BY_DOCUMENT");
    assert.deepEqual(optText(qs[0], qs[0].answer.correctOptionIds), ["лобная кость"]);
  });
  test("ordering detected with [NN] codes", () => {
    assert.equal(qs[1].questionType, "ORDERING");
    const order = qs[1].answer.correctOrder!.map((id) => qs[1].options.find((o) => o.id === id)!.text);
    assert.deepEqual(order, ["шейный", "грудной", "поясничный", "крестцовый"]);
  });
  test("image question across pages has image and options", () => {
    assert.equal(qs[2].questionType, "IMAGE_IDENTIFICATION");
    assert.equal(qs[2].images.length, 1);
    assert.equal(qs[2].images[0].referencedLabel, "17");
    assert.equal(qs[2].options.length, 2);
  });
  test("formula preserved with superscripts, latex produced", () => {
    assert.ok(qs[3].options[0].text.includes("10⁻³"));
    assert.ok(qs[3].formulas.some((f) => f.latex?.includes("^{-3}")));
    assert.deepEqual(optText(qs[3], qs[3].answer.correctOptionIds), ["1,5·10⁻³ м"]);
  });
  test("generic image stems are not auto-merged", () => {
    const b = analyzeDocument(numberedWithFeedback(), { documentId: "doc-num-2" });
    const imgA = { ...qs[2] };
    const imgB = { ...b.instances[2], options: b.instances[2].options.map((o, i) => (i === 0 ? { ...o, normalizedText: "плечевая кость", text: "плечевая кость" } : o)) };
    const agg = aggregate([imgA, imgB], [], key);
    assert.equal(agg.canonicals.length, 2);
  });
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll ingestion tests passed");
process.exit(failures ? 1 : 0);
