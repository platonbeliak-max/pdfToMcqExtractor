import { z } from "zod";

export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  options: z
    .array(z.object({ key: z.string().max(4), text: z.string().max(600) }))
    .max(10)
    .default([]),
});

const STOP_WORDS = new Set([
  "какой", "какая", "какое", "какие", "который", "которая", "которое", "которые", "является",
  "являются", "выберите", "укажите", "отметьте", "правильный", "правильные", "ответ", "ответы",
  "запишите", "впишите", "название", "подпишите", "что", "это", "для", "при", "или", "как", "под",
  "над", "его", "ее", "их", "вариант", "which", "what", "the", "and", "are", "following", "select",
  "choose", "correct", "answer", "write", "name",
]);

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [])
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => w.slice(0, 5));
}

function keywords(text: string, limit: number): string {
  return Array.from(new Set(text.match(/[a-zа-яё]{4,}/gi) ?? []))
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit)
    .join(" ");
}

function coverage(needles: string[], haystack: Set<string>): number {
  return needles.length ? needles.filter((w) => haystack.has(w)).length / needles.length : 0;
}

function countPhrase(text: string, phrase: string): number {
  const p = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (p.length < 4) return 0;
  return text.toLowerCase().split(p).length - 1;
}

type SourceKind = "wikipedia" | "pubmed" | "europepmc";

interface Doc {
  kind: SourceKind;
  title: string;
  rawTitle: string;
  url: string;
  text: string;
  englishTitle?: string;
}

const UA = { "User-Agent": "pdf-mcq-study-app/1.0 (educational)" };

const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
const cache = new Map<string, string>();

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Polite fetch for the free public APIs: shared concurrency limit, in-memory cache, backoff on 429. */
async function fetchBody(url: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = await slot(async () => {
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
        if (res.status === 429 || res.status === 503) return "retry" as const;
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    });
    if (outcome !== "retry") {
      if (outcome !== null) {
        if (cache.size > 500) cache.clear();
        cache.set(url, outcome);
      }
      return outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  return null;
}

async function getJson<T>(url: string): Promise<T | null> {
  const body = await fetchBody(url);
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string> {
  return (await fetchBody(url)) ?? "";
}

interface WikiApiPage {
  title: string;
  extract?: string;
  langlinks?: { lang: string; title: string }[];
}

async function wikiSearch(lang: "ru" | "en", query: string, limit = 3): Promise<Doc[]> {
  if (!query.trim()) return [];
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const found = await getJson<{ query?: { search?: { title: string }[] } }>(
    `${base}?${new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json", formatversion: "2" })}`,
  );
  const titles = (found?.query?.search ?? []).map((x) => x.title);
  if (titles.length === 0) return [];

  const data = await getJson<{ query?: { pages?: WikiApiPage[] } }>(
    `${base}?${new URLSearchParams({
      action: "query",
      titles: titles.join("|"),
      prop: "extracts|langlinks",
      explaintext: "1",
      exlimit: "max",
      exchars: "6000",
      lllang: "en",
      lllimit: "max",
      format: "json",
      formatversion: "2",
    })}`,
  );
  const pages = data?.query?.pages ?? [];
  return titles
    .map((title) => pages.find((pg) => pg.title === title))
    .filter((pg): pg is WikiApiPage => !!pg)
    .map((pg) => ({
      kind: "wikipedia" as const,
      title: `${pg.title} (Wikipedia ${lang.toUpperCase()})`,
      rawTitle: pg.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pg.title.replace(/ /g, "_"))}`,
      text: `${pg.title}. ${pg.extract ?? ""}`,
      englishTitle: lang === "en" ? pg.title : pg.langlinks?.find((l) => l.lang === "en")?.title,
    }));
}

function xmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function pubmedSearch(query: string): Promise<Doc[]> {
  if (!query.trim()) return [];
  const eutils = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const ids = await getJson<{ esearchresult?: { idlist?: string[] } }>(
    `${eutils}/esearch.fcgi?${new URLSearchParams({ db: "pubmed", term: query, retmax: "5", retmode: "json", sort: "relevance" })}`,
  );
  const list = ids?.esearchresult?.idlist ?? [];
  if (list.length === 0) return [];
  const xml = await getText(`${eutils}/efetch.fcgi?${new URLSearchParams({ db: "pubmed", id: list.join(","), retmode: "xml" })}`);
  return xml
    .split("<PubmedArticle>")
    .slice(1)
    .map((block) => {
      const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
      const title = xmlText(block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "");
      const abstract = Array.from(block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g))
        .map((m) => xmlText(m[1]))
        .join(" ");
      return pmid && title
        ? {
            kind: "pubmed" as const,
            title: `${title} (PubMed)`,
            rawTitle: title,
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            text: `${title}. ${abstract}`,
          }
        : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

async function europePmcCount(query: string): Promise<number> {
  const data = await getJson<{ hitCount?: number }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({ query, format: "json", pageSize: "1" })}`,
  );
  return data?.hitCount ?? 0;
}

async function europePmcSearch(query: string): Promise<Doc[]> {
  const data = await getJson<{
    resultList?: { result?: { id?: string; source?: string; title?: string; abstractText?: string }[] };
  }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({ query, format: "json", resultType: "core", pageSize: "4" })}`,
  );
  return (data?.resultList?.result ?? [])
    .filter((r) => r.id && r.source && r.title)
    .map((r) => ({
      kind: "europepmc" as const,
      title: `${xmlText(r.title ?? "")} (Europe PMC)`,
      rawTitle: xmlText(r.title ?? ""),
      url: `https://europepmc.org/article/${r.source}/${r.id}`,
      text: `${xmlText(r.title ?? "")}. ${xmlText(r.abstractText ?? "")}`,
    }));
}

function quote(term: string): string {
  return `"${term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

/** Index of the clear winner, or -1 when the top score is weak or ties with the runner-up. */
function pickWinner(scores: number[], minTop: number, minMargin: number): number {
  let best = -1;
  let second = -Infinity;
  scores.forEach((s, i) => {
    if (best === -1 || s > scores[best]) {
      second = best === -1 ? -Infinity : scores[best];
      best = i;
    } else if (s > second) {
      second = s;
    }
  });
  if (best === -1 || scores[best] < minTop) return -1;
  return scores[best] - (second === -Infinity ? 0 : second) >= minMargin ? best : -1;
}

function matchesOption(optionText: string, doc: Doc | undefined): Doc | undefined {
  if (!doc) return undefined;
  const wanted = Array.from(new Set(stems(optionText)));
  if (wanted.length === 0) return undefined;
  const titleStems = new Set(stems(doc.rawTitle));
  const textStems = new Set(stems(doc.text.slice(0, 400)));
  return coverage(wanted, titleStems) >= 0.5 || coverage(wanted, textStems) >= 0.75 ? doc : undefined;
}

interface Check {
  label: string;
  winner: number;
}

function uniqueSources(docs: (Doc | undefined)[], limit = 6) {
  const seen = new Set<string>();
  return docs
    .filter((d): d is Doc => !!d)
    .filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)))
    .slice(0, limit)
    .map((d) => ({ title: d.title, url: d.url, kind: d.kind }));
}

async function choiceLookup(question: string, allOptions: { key: string; text: string }[]): Promise<Response> {
  const options = allOptions.slice(0, 8);
  const lang: "ru" | "en" = /[а-яё]/i.test(question) ? "ru" : "en";
  const questionStems = Array.from(new Set(stems(question)));
  const questionQuery = keywords(question, 5);
  if (!questionQuery || questionStems.length === 0) return Response.json({ error: "no_answer" }, { status: 404 });

  const [questionDocs, ...optionDocLists] = await Promise.all([
    wikiSearch(lang, questionQuery, 4),
    ...options.map((o) => wikiSearch(lang, o.text, 2).catch(() => [] as Doc[])),
  ]);

  const ownDocs = options.map((o, i) => optionDocLists[i]?.map((d) => matchesOption(o.text, d)).find(Boolean));
  const questionEnglish = questionDocs.map((d) => d.englishTitle).find(Boolean);
  const optionEnglish = options.map((o, i) => ownDocs[i]?.englishTitle ?? (lang === "en" ? o.text : undefined));

  const [englishDocs, scientificDocs, ...hitCounts] = await Promise.all([
    questionEnglish ? wikiSearch("en", questionEnglish, 3) : Promise.resolve([] as Doc[]),
    questionEnglish ? pubmedSearch(`${quote(questionEnglish)} anatomy`) : Promise.resolve([] as Doc[]),
    ...options.map((_, i) => {
      const en = optionEnglish[i];
      return questionEnglish && en ? europePmcCount(`${quote(en)} AND ${quote(questionEnglish)}`) : Promise.resolve(0);
    }),
  ]);

  const checks: Check[] = [];

  const generalText = questionDocs.map((d) => d.text).join(" ").toLowerCase();
  const generalStems = new Set(stems(generalText));
  checks.push({
    label: lang === "ru" ? "статьи Википедии по теме вопроса" : "Wikipedia articles on the question topic",
    winner: pickWinner(
      options.map((o) => {
        const phrase = countPhrase(generalText, o.text) > 0 ? 1 : 0;
        return Math.max(phrase, coverage(Array.from(new Set(stems(o.text))), generalStems));
      }),
      0.5,
      0.2,
    ),
  });

  checks.push({
    label: lang === "ru" ? "собственная статья Википедии о варианте" : "the option's own Wikipedia article",
    winner: pickWinner(
      options.map((_, i) => (ownDocs[i] ? coverage(questionStems, new Set(stems(ownDocs[i]!.text))) : 0)),
      0.4,
      0.15,
    ),
  });

  if (englishDocs.length > 0) {
    const englishText = englishDocs.map((d) => d.text).join(" ");
    checks.push({
      label: lang === "ru" ? "английская Википедия" : "English Wikipedia",
      winner: pickWinner(options.map((_, i) => (optionEnglish[i] ? countPhrase(englishText, optionEnglish[i]!) : 0)), 1, 1),
    });
  }

  if (scientificDocs.length > 0) {
    const abstractText = scientificDocs.map((d) => d.text).join(" ");
    checks.push({
      label: "PubMed",
      winner: pickWinner(options.map((_, i) => (optionEnglish[i] ? countPhrase(abstractText, optionEnglish[i]!) : 0)), 1, 1),
    });
  }

  if (hitCounts.some((n) => n > 0)) {
    checks.push({
      label: "Europe PMC",
      winner: pickWinner(hitCounts as number[], 3, Math.max(2, Math.max(...(hitCounts as number[])) * 0.25)),
    });
  }

  const votes = new Map<number, string[]>();
  checks.forEach((c) => {
    if (c.winner >= 0) votes.set(c.winner, [...(votes.get(c.winner) ?? []), c.label]);
  });
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = ranked[0];
  if (!top || (ranked[1] && ranked[1][1].length === top[1].length)) {
    return Response.json(
      { error: "no_answer", debug: { checks, questionEnglish, optionEnglish, hitCounts, own: ownDocs.map((d) => d?.rawTitle), q: questionDocs.map((d) => d.rawTitle) } },
      { status: 404 },
    );
  }

  const [winnerIndex, agreed] = top;
  const winner = options[winnerIndex];
  const ru = lang === "ru";
  return Response.json({
    keys: [winner.key],
    answerText: winner.text,
    explanation: ru
      ? `Подтверждено ${agreed.length} из ${checks.length} независимых проверок по открытым источникам: ${agreed.join("; ")}. Ответ подобран автоматически, без ИИ — сверьтесь со ссылками.`
      : `Confirmed by ${agreed.length} of ${checks.length} independent checks against open sources: ${agreed.join("; ")}. Picked automatically, without AI — please verify via the links.`,
    confidence: agreed.length >= 3 ? "high" : agreed.length === 2 ? "medium" : "low",
    mode: "free",
    sources: uniqueSources([ownDocs[winnerIndex], ...questionDocs, ...englishDocs, ...scientificDocs]),
  });
}

async function openLookup(question: string): Promise<Response> {
  const lang: "ru" | "en" = /[а-яё]/i.test(question) ? "ru" : "en";
  const questionStems = Array.from(new Set(stems(question)));
  const query = keywords(question, 5);
  if (!query || questionStems.length === 0) return Response.json({ error: "no_answer" }, { status: 404 });

  const [byKeywords, byQuestion, byShort] = await Promise.all([
    wikiSearch(lang, query, 4),
    wikiSearch(lang, question.slice(0, 250), 4),
    wikiSearch(lang, keywords(question, 3), 4),
  ]);

  const tally = new Map<string, { doc: Doc; searches: number }>();
  [byKeywords, byQuestion, byShort].forEach((docs) => {
    docs.slice(0, 2).forEach((d) => {
      if (coverage(questionStems, new Set(stems(d.text))) < 0.4) return;
      const entry = tally.get(d.rawTitle);
      tally.set(d.rawTitle, { doc: d, searches: (entry?.searches ?? 0) + 1 });
    });
  });

  const ranked = [...tally.values()].sort((a, b) => b.searches - a.searches);
  const best = ranked[0];
  if (!best || best.searches < 2 || (ranked[1] && ranked[1].searches === best.searches)) {
    return Response.json({ error: "no_answer" }, { status: 404 });
  }

  const scientific = best.doc.englishTitle ? await pubmedSearch(quote(best.doc.englishTitle)) : [];
  const confirmations = best.searches + (scientific.length > 0 ? 1 : 0);
  const ru = lang === "ru";
  return Response.json({
    keys: [],
    answerText: best.doc.rawTitle,
    explanation: ru
      ? `Термин найден ${best.searches} из 3 независимых поисков по Википедии${scientific.length > 0 ? " и подтверждён публикациями PubMed" : ""}. Ответ подобран автоматически, без ИИ — проверьте формулировку по ссылкам.`
      : `The term was found by ${best.searches} of 3 independent Wikipedia searches${scientific.length > 0 ? " and confirmed by PubMed" : ""}. Picked automatically, without AI — please verify via the links.`,
    confidence: confirmations >= 4 ? "high" : confirmations === 3 ? "medium" : "low",
    mode: "free",
    sources: uniqueSources([best.doc, ...scientific, ...ranked.slice(1).map((r) => r.doc)]),
  });
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { question, options } = parsed.data;
  try {
    return options.length > 0 ? await choiceLookup(question, options) : await openLookup(question);
  } catch (err) {
    console.error("[answer] lookup failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
