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

/** Short roots survive Russian case endings ("мышцу"/"мышца", "трапециевидную"/"трапециевидной"). */
function roots(text: string): string[] {
  return Array.from(
    new Set(
      (text.toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [])
        .filter((w) => !STOP_WORDS.has(w))
        .map((w) => w.replace(/ё/g, "е").slice(0, 4)),
    ),
  );
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.length > 15 && s.length < 1200);
}

/**
 * How strongly one sentence ties the option to the question: the option must be named in the sentence
 * (or the sentence belongs to the option's own article) and the question's own key words must sit beside it.
 */
function sentenceEvidence(question: string, optionText: string, docs: Doc[], ownDoc: Doc | undefined): number {
  const optionRoots = roots(optionText);
  // Long words ("трапециевидную") name the topic; short ones ("мышцу") appear everywhere, so weight by length.
  const weights = new Map<string, number>();
  for (const w of question.toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? []) {
    if (STOP_WORDS.has(w)) continue;
    const r = w.replace(/ё/g, "е").slice(0, 4);
    if (!optionRoots.includes(r)) weights.set(r, Math.max(weights.get(r) ?? 0, w.length));
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total === 0 || optionRoots.length === 0) return 0;
  let best = 0;
  let strongHits = 0;
  const consider = (sentence: string, mustNameOption: boolean) => {
    const set = new Set(roots(sentence));
    if (mustNameOption && coverage(optionRoots, set) < 0.75) return;
    let found = 0;
    for (const [r, w] of weights) if (set.has(r)) found += w;
    const score = found / total;
    if (score > best) best = score;
    if (score >= 0.66) strongHits++;
  };
  for (const doc of docs) for (const s of sentencesOf(doc.text)) consider(s, true);
  if (ownDoc) for (const s of sentencesOf(ownDoc.text)) consider(s, false);
  // Repeated strong sentences break ties between options that each have one lucky match.
  return best + Math.min(strongHits, 5) * 0.01;
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

const TRUE_WORDS = /^(верно|правильно|да|true|yes|correct)$/i;
const FALSE_WORDS = /^(неверно|неправильно|нет|false|no|incorrect)$/i;

/**
 * "Верно/Неверно": the statement counts as true only when one article sentence restates nearly all of it
 * with the same negation. Absence of such a sentence is not proof of falsehood, so that case stays unanswered.
 */
async function statementLookup(
  statement: string,
  trueKey: string,
  trueText: string,
  falseKey: string,
  falseText: string,
): Promise<Response> {
  const lang: "ru" | "en" = /[а-яё]/i.test(statement) ? "ru" : "en";
  const wanted = roots(statement);
  if (wanted.length < 3) return Response.json({ error: "no_answer" }, { status: 404 });
  const [a, b] = await Promise.all([
    wikiSearch(lang, keywords(statement, 5), 4).catch(() => [] as Doc[]),
    wikiSearch(lang, keywords(statement, 3), 3).catch(() => [] as Doc[]),
  ]);
  const docs = [...a, ...b];
  if (docs.length === 0) throw new SourcesUnavailableError();
  const negated = (s: string) => /(^|\s)(не|нет|ни|not|no|never)\s/i.test(` ${s.toLowerCase()} `);
  const statementNegated = negated(statement);
  let best: { doc: Doc; score: number; same: boolean } | null = null;
  for (const doc of docs) {
    for (const sentence of sentencesOf(doc.text)) {
      const score = coverage(wanted, new Set(roots(sentence)));
      const same = negated(sentence) === statementNegated;
      // On equal coverage prefer the sentence with matching polarity: a contradiction needs stronger proof.
      if (!best || score > best.score || (score === best.score && same && !best.same)) best = { doc, score, same };
    }
  }
  if (!best || best.score < (best.same ? 0.8 : 0.9)) return Response.json({ error: "no_answer" }, { status: 404 });
  const ru = lang === "ru";
  const isTrue = best.same;
  return Response.json({
    keys: [isTrue ? trueKey : falseKey],
    answerText: isTrue ? trueText : falseText,
    explanation: ru
      ? isTrue
        ? `Утверждение почти дословно подтверждено текстом статьи «${best.doc.rawTitle}». Ответ подобран автоматически по источникам, без ИИ.`
        : `В статье «${best.doc.rawTitle}» то же утверждение сформулировано с противоположным отрицанием. Ответ подобран автоматически по источникам, без ИИ.`
      : isTrue
        ? `The statement is restated almost verbatim in “${best.doc.rawTitle}”. Picked automatically from sources, without AI.`
        : `“${best.doc.rawTitle}” states the same thing with the opposite negation. Picked automatically from sources, without AI.`,
    confidence: best.score === 1 ? "medium" : "low",
    mode: "free",
    sources: uniqueSources([best.doc]),
  });
}

async function choiceLookup(question: string, allOptions: { key: string; text: string }[]): Promise<Response> {
  const trueOption = allOptions.find((o) => TRUE_WORDS.test(o.text.trim()));
  const falseOption = allOptions.find((o) => FALSE_WORDS.test(o.text.trim()));
  if (allOptions.length === 2 && trueOption && falseOption) {
    return statementLookup(question, trueOption.key, trueOption.text, falseOption.key, falseOption.text);
  }
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

  checks.push({
    label: lang === "ru" ? "предложения статей, где вариант стоит рядом с ключевыми словами вопроса" : "article sentences pairing the option with the question's key words",
    winner: pickWinner(
      options.map((o, i) => sentenceEvidence(question, o.text, questionDocs, ownDocs[i])),
      0.65,
      0.15,
    ),
  });

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

  // The first three checks read what articles actually say; the rest only count co-occurrences, which
  // favour frequently mentioned organs like "liver", so they weigh a quarter as much.
  const contentLabels = new Set(checks.slice(0, 3).map((c) => c.label));
  const weightOf = (label: string) => (contentLabels.has(label) ? 2 : 0.5);
  const votes = new Map<number, string[]>();
  checks.forEach((c) => {
    if (c.winner >= 0) votes.set(c.winner, [...(votes.get(c.winner) ?? []), c.label]);
  });
  const scoreOf = (labels: string[]) => labels.reduce((sum, l) => sum + weightOf(l), 0);
  const ranked = [...votes.entries()].sort((a, b) => scoreOf(b[1]) - scoreOf(a[1]));
  const top = ranked[0];
  const hasContentVote = !!top && top[1].some((label) => contentLabels.has(label));
  const topScore = top ? scoreOf(top[1]) : 0;
  const runnerUpScore = ranked[1] ? scoreOf(ranked[1][1]) : 0;
  const runnerUp = ranked[1]?.[1].length ?? 0;
  // Two content checks pointing at different options cancel out; weak co-occurrence votes cannot outvote content.
  const accepted = !!top && hasContentVote && topScore - runnerUpScore >= 1;
  if (!accepted) {
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
    confidence: topScore >= 4 && runnerUp === 0 ? "high" : topScore - runnerUpScore >= 2.5 ? "medium" : "low",
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
  let free: Response | null = null;
  try {
    free = await budget.run({ deadline: Date.now() + REQUEST_BUDGET_MS }, () =>
      options.length > 0 ? choiceLookup(question, options) : openLookup(question),
    );
  } catch (err) {
    if (!(err instanceof SourcesUnavailableError)) console.error("[answer] free lookup failed:", err);
  }
  return free ?? Response.json({ error: "no_answer" }, { status: 404 });
}
