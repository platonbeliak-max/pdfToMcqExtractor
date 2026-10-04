const questions = [
  ["Какой нерв иннервирует трапециевидную мышцу?", ["Добавочный нерв", "Лицевой нерв", "Блуждающий нерв", "Языкоглоточный нерв"]],
  ["Какая артерия кровоснабжает основную часть головного мозга?", ["Внутренняя сонная артерия", "Наружная сонная артерия", "Подключичная артерия", "Лицевая артерия"]],
  ["Какая кость образует лоб?", ["Лобная кость", "Теменная кость", "Височная кость", "Затылочная кость"]],
  ["Какая мышца сгибает предплечье в локтевом суставе?", ["Двуглавая мышца плеча", "Трёхглавая мышца плеча", "Дельтовидная мышца", "Трапециевидная мышца"]],
  ["Какой нерв иннервирует диафрагму?", ["Диафрагмальный нерв", "Блуждающий нерв", "Лучевой нерв", "Локтевой нерв"]],
  ["Какой орган вырабатывает инсулин?", ["Поджелудочная железа", "Печень", "Селезёнка", "Желчный пузырь"]],
];
const base = process.env.BASE ?? "http://localhost:3000";
const parallel = Number(process.env.PAR ?? 1);
const started = Date.now();
let next = 0;
const rows = [];
async function worker() {
  while (next < questions.length) {
    const [question, opts] = questions[next++];
    const t0 = Date.now();
    const res = await fetch(`${base}/api/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, options: opts.map((text, i) => ({ key: "ABCD"[i], text })) }),
    });
    const body = await res.json();
    rows.push(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${res.status}  ${body.answerText ?? body.error}  ${body.confidence ?? ""}  | ${question.slice(0, 40)}`);
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
console.log(rows.join("\n"));
console.log(`TOTAL ${((Date.now() - started) / 1000).toFixed(1)}s for ${questions.length} questions, parallel=${parallel}`);
