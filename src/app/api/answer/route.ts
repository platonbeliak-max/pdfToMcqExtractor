import { AsyncLocalStorage } from "node:async_hooks";
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

// Wikimedia throttles generic agents hard; its policy asks for a contact URL in the User-Agent.
const UA = { "User-Agent": "PdfMcqStudyApp/1.0 (https://github.com/platonbeliak-max/pdfToMcqExtractor)" };

interface HostLimiter {
  max: number;
  running: number;
  waiting: (() => void)[];
  pausedUntil: number;
}

const limiters = new Map<string, HostLimiter>();
const cache = new Map<string, string>();

// Wikipedia answers 429 to bursts, so it gets a small shared budget; other hosts tolerate more.
function limiterFor(url: string): HostLimiter {
  const host = new URL(url).hostname;
  const key = host.endsWith("wikipedia.org") ? "wikipedia" : host;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = { max: key === "wikipedia" ? 2 : 5, running: 0, waiting: [], pausedUntil: 0 };
    limiters.set(key, limiter);
  }
  return limiter;
}

async function withLimiter<T>(limiter: HostLimiter, task: () => Promise<T>): Promise<T> {
  if (limiter.running >= limiter.max) await new Promise<void>((resolve) => limiter.waiting.push(resolve));
  limiter.running++;
  try {
    const pause = limiter.pausedUntil - Date.now();
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    return await task();
  } finally {
    limiter.running--;
    limiter.waiting.shift()?.();
  }
}

const MAX_ATTEMPTS = 2;
const MAX_PAUSE_MS = 2500;
const REQUEST_BUDGET_MS = 10_000;
const FETCH_TIMEOUT_MS = 3_500;

const budget = new AsyncLocalStorage<{ deadline: number }>();

/** Polite fetch for the free public APIs: per-host concurrency limit, in-memory cache, shared pause on 429, one time budget per question. */
async function fetchBody(url: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const limiter = limiterFor(url);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const outcome = await withLimiter(limiter, async () => {
      const left = (budget.getStore()?.deadline ?? Infinity) - Date.now();
      if (left < 600) return null;
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, left)) });
        if (res.status === 429 || res.status >= 500) {
          const asked = Number(res.headers.get("retry-after"));
          const pause = Math.min(MAX_PAUSE_MS, (Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1200) * (attempt + 1));
          limiter.pausedUntil = Math.max(limiter.pausedUntil, Date.now() + pause);
          return "retry" as const;
        }
        return res.ok ? await res.text() : null;
      } catch {
        return "retry" as const;
      }
    });
    if (outcome !== "retry") {
      if (outcome !== null) {
        if (cache.size > 500) cache.clear();
        cache.set(url, outcome);
      }
      return outcome;
    }
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

class SourcesUnavailableError extends Error {
  constructor() {
    super("sources_unavailable");
  }
}

interface WikiApiPage {
  title: string;
  index?: number;
  extract?: string;
  missing?: boolean;
  pageprops?: { disambiguation?: string };
  langlinks?: { lang: string; title: string }[];
}

function toWikiDocs(lang: "ru" | "en", pages: WikiApiPage[]): Doc[] {
  return pages
    .filter((pg) => !pg.missing && !pg.pageprops?.disambiguation)
    .map((pg) => ({
      kind: "wikipedia" as const,
      title: `${pg.title} (Wikipedia ${lang.toUpperCase()})`,
      rawTitle: pg.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pg.title.replace(/ /g, "_"))}`,
      text: `${pg.title}. ${pg.extract ?? ""}`,
      englishTitle: lang === "en" ? pg.title : pg.langlinks?.find((l) => l.lang === "en")?.title,
    }));
}

const WIKI_PAGE_FIELDS = {
  prop: "extracts|langlinks|pageprops",
  ppprop: "disambiguation",
  explaintext: "1",
  exlimit: "max",
  exchars: "6000",
  lllang: "en",
  lllimit: "max",
  format: "json",
  formatversion: "2",
};

/** One request: full-text search and the page extracts together. */
async function wikiSearch(lang: "ru" | "en", query: string, limit = 3): Promise<Doc[]> {
  if (!query.trim()) return [];
  const data = await getJson<{ query?: { pages?: WikiApiPage[] } }>(
    `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrlimit: String(limit),
      ...WIKI_PAGE_FIELDS,
    })}`,
  );
  if (data === null) throw new SourcesUnavailableError();
  return toWikiDocs(lang, [...(data.query?.pages ?? [])].sort((x, y) => (x.index ?? 0) - (y.index ?? 0)));
}

/** One request for many exact titles (redirects followed); the key is the title as asked. */
async function wikiByTitles(lang: "ru" | "en", titles: string[]): Promise<Map<string, Doc>> {
  const asked = Array.from(new Set(titles.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length >= 3 && t.length <= 200)));
  const found = new Map<string, Doc>();
  if (asked.length === 0) return found;
  const data = await getJson<{
    query?: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages?: WikiApiPage[];
    };
  }>(
    `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      titles: asked.join("|"),
      redirects: "1",
      ...WIKI_PAGE_FIELDS,
    })}`,
  );
  if (data === null) return found;
  const docs = new Map(toWikiDocs(lang, data.query?.pages ?? []).map((d) => [d.rawTitle, d]));
  for (const from of asked) {
    let title = from;
    title = data.query?.normalized?.find((n) => n.from === title)?.to ?? title;
    title = data.query?.redirects?.find((n) => n.from === title)?.to ?? title;
    const doc = docs.get(title);
    if (doc) found.set(from, doc);
  }
  return found;
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

function quote(term: string): string {
  return `"${term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

/** Papers say "sternocleidomastoid", not "sternocleidomastoid muscle", so drop the generic trailing noun. */
function coreTerm(term: string): string {
  const core = term.replace(/\s+(muscle|muscles|nerve|artery|vein|bone|ligament|gland)$/i, "").trim();
  return core.length >= 4 ? core : term;
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

  // Generic words ("какой", "нерв") drag searches toward broad overview pages; the longest words carry the topic.
  const topicQuery = Array.from(new Set(question.match(/[a-zа-яё]{6,}/gi) ?? []))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .join(" ");

  let mainFailed = false;
  const [mainDocs, topicDocs, byTitle] = await Promise.all([
    wikiSearch(lang, questionQuery, 4).catch(() => {
      mainFailed = true;
      return [] as Doc[];
    }),
    topicQuery && topicQuery !== questionQuery ? wikiSearch(lang, topicQuery, 3).catch(() => [] as Doc[]) : Promise.resolve([] as Doc[]),
    wikiByTitles(lang, options.map((o) => o.text)),
  ]);
  const seenTitles = new Set<string>();
  const questionDocs = [...mainDocs, ...topicDocs].filter((d) => (seenTitles.has(d.rawTitle) ? false : (seenTitles.add(d.rawTitle), true)));
  if (mainFailed && questionDocs.length === 0 && byTitle.size === 0) throw new SourcesUnavailableError();

  const normalizedTitle = (text: string) => text.replace(/\s+/g, " ").trim();
  const ownDocs: (Doc | undefined)[] = options.map((o) => byTitle.get(normalizedTitle(o.text)));
  // Options that are not an exact article title (inflected forms, longer phrases) fall back to a search; capped to stay polite.
  const unresolved = options.map((o, i) => i).filter((i) => !ownDocs[i]).slice(0, 3);
  await Promise.all(
    unresolved.map(async (i) => {
      const found = await wikiSearch(lang, options[i].text, 2).catch(() => [] as Doc[]);
      ownDocs[i] = found.map((d) => matchesOption(options[i].text, d)).find(Boolean);
    }),
  );
  const questionStemSet = new Set(questionStems);
  const topicDoc = questionDocs
    .filter((d) => d.englishTitle)
    .map((d) => ({ d, fit: coverage(Array.from(new Set(stems(d.rawTitle))), questionStemSet) }))
    .filter((x) => x.fit >= 0.6)
    .sort((a, b) => b.fit - a.fit)[0]?.d;
  const questionEnglish = topicDoc?.englishTitle;
  const optionEnglish = options.map((o, i) => ownDocs[i]?.englishTitle ?? (lang === "en" ? o.text : undefined));

  const [englishDocs, scientificDocs, ...hitCounts] = await Promise.all([
    questionEnglish ? wikiSearch("en", questionEnglish, 3) : Promise.resolve([] as Doc[]),
    questionEnglish ? pubmedSearch(`${quote(questionEnglish)} anatomy`) : Promise.resolve([] as Doc[]),
    ...options.map((_, i) => {
      const en = optionEnglish[i];
      return questionEnglish && en
        ? europePmcCount(`TITLE_ABS:${quote(en)} AND TITLE_ABS:${quote(coreTerm(questionEnglish))}`)
        : Promise.resolve(0);
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
    winner: (() => {
      const ownStems = ownDocs.map((d) => (d ? new Set(stems(d.text)) : null));
      const present = ownStems.filter((s): s is Set<string> => s !== null);
      // Stems every option's article shares ("орган", "какой") cannot tell the options apart.
      const distinctive = questionStems.filter((s) => present.length < 2 || !present.every((set) => set.has(s)));
      const wanted = distinctive.length > 0 ? distinctive : questionStems;
      return pickWinner(ownStems.map((set) => (set ? coverage(wanted, set) : 0)), 0.4, 0.15);
    })(),
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
      winner: pickWinner(options.map((_, i) => (optionEnglish[i] ? countPhrase(abstractText, optionEnglish[i]!) : 0)), 2, 2),
    });
  }

  if (hitCounts.some((n) => n > 0)) {
    checks.push({
      label: "Europe PMC",
      winner: pickWinner(hitCounts as number[], 8, Math.max(5, Math.max(...(hitCounts as number[])) * 0.4)),
    });
  }

  const votes = new Map<number, string[]>();
  checks.forEach((c) => {
    if (c.winner >= 0) votes.set(c.winner, [...(votes.get(c.winner) ?? []), c.label]);
  });
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = ranked[0];
  // Co-occurrence counts (English phrase hits, Europe PMC) favour common organs like "liver"; at least one check must read article content.
  const contentLabels = new Set(checks.slice(0, 2).map((c) => c.label));
  const hasContentVote = !!top && top[1].some((label) => contentLabels.has(label));
  if (!top || ranked.length > 1 || top[1].length < 2 || !hasContentVote) {
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

  let failures = 0;
  const tolerant = (p: Promise<Doc[]>) =>
    p.catch(() => {
      failures++;
      return [] as Doc[];
    });
  const [byKeywords, byQuestion, byShort] = await Promise.all([
    tolerant(wikiSearch(lang, query, 4)),
    tolerant(wikiSearch(lang, question.slice(0, 250), 4)),
    tolerant(wikiSearch(lang, keywords(question, 3), 4)),
  ]);
  if (failures === 3) throw new SourcesUnavailableError();

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
      ? `Термин найден ${best.searches} из 3 независимых поисков по Википедии${scientific.length > 0 ? " и подтверждён публикациями PubMed" : ""}. Ответ подобран автоматически, без ИИ ��� проверьте формули��овку по ссылкам.`
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
  let free: Response | null = null;
  try {
    free = await budget.run({ deadline: Date.now() + REQUEST_BUDGET_MS }, () =>
      options.length > 0 ? choiceLookup(question, options) : openLookup(question),
    );
  } catch (err) {
    if (!(err instanceof SourcesUnavailableError)) console.error("[answer] free lookup failed:", err);
  }
  if (free?.ok) return free;

  if (!process.env.GROQ_API_KEY) return Response.json({ error: "missing_key" }, { status: 500 });
  try {
    return Response.json(await aiLookup(question, options));
  } catch (err) {
    if (err instanceof AiRateLimited) return Response.json({ error: "rate_limited" }, { status: 429 });
    console.error("[answer] AI fallback failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}

class AiRateLimited extends Error {}

// Groq's free tier caps tokens per minute per model, so rotating models multiplies throughput.
const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

async function groqJson(system: string, prompt: string): Promise<unknown> {
  for (const model of GROQ_MODELS) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 429 || res.status === 503) continue;
    if (!res.ok) throw new Error(`groq ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = data.choices[0]?.message?.content ?? "";
    return JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  }
  throw new AiRateLimited();
}

const aiSchema = z.object({
  keys: z.array(z.string()).describe("Keys of the correct options; empty when there are no options"),
  answerText: z.string().describe("The answer itself: option text(s), or the word/term for open questions"),
  explanation: z.string().describe("1–2 sentence justification in the question's language"),
  confidence: z.enum(["high", "medium", "low"]),
});

async function aiLookup(question: string, options: { key: string; text: string }[]) {
  const ru = /[а-яё]/i.test(question);
  const output = aiSchema.parse(
    await groqJson(
      "Ты — эксперт-преподаватель медицинского вуза (анатомия, топографическая анатомия, оперативная хирургия, физиология и т.д.). " +
      "Всегда давай ответ — даже если вопрос распознан с шумом OCR или частично обрезан: опирайся на смысл и выбери наиболее вероятный ответ. " +
      "Для вопросов с вариантами верни ключи всех правильных вариантов (может быть несколько). " +
      "Для открытых вопросов и вопросов с пропуском верни короткое слово или термин, который нужно вписать. " +
      "Если в формулировке уже содержится ответ (например «…называется канюля Люэра, в ответе указать эпоним»), верни именно это слово (Люэр). " +
      "Для «Верно/Неверно» выбери соответствующий вариант. Отвечай на языке вопроса. " +
      'Верни только JSON: {"keys": string[], "answerText": string, "explanation": string, "confidence": "high"|"medium"|"low"}.',
      options.length > 0
        ? `Вопрос: ${question}\n\nВарианты:\n${options.map((o) => `${o.key}) ${o.text}`).join("\n")}`
        : `Вопрос (открытый, без вариантов): ${question}`,
    ),
  );
  const valid = new Set(options.map((o) => o.key.toUpperCase()));
  const keys = output.keys.map((k) => k.trim().toUpperCase().replace(/[^A-ZА-Я0-9]/g, "")).filter((k) => valid.has(k));
  const answerText =
    keys.length > 0 ? options.filter((o) => keys.includes(o.key.toUpperCase())).map((o) => o.text).join("; ") : output.answerText.trim();
  if (!answerText) throw new Error("empty AI answer");
  return {
    keys,
    answerText,
    explanation: output.explanation + (ru ? " (Ответ ИИ — мед. источники не дали однозначного подтверждения.)" : " (AI answer — open sources were not conclusive.)"),
    confidence: output.confidence,
    mode: "ai" as const,
    sources: [],
  };
}
