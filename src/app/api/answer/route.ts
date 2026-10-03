import { z } from "zod";

export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

const requestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  options: z
    .array(z.object({ key: z.string().max(4), text: z.string().max(600) }))
    .max(10)
    .default([]),
});

interface GroqSearchResult {
  title?: string;
  url?: string;
}

interface GroqResponse {
  choices?: {
    message?: {
      content?: string | null;
      executed_tools?: { search_results?: { results?: GroqSearchResult[] } }[];
    };
  }[];
}

const SYSTEM_PROMPT =
  "You are a medical exam assistant (anatomy, physiology, histology, clinical medicine). " +
  "Search medical sources before answering and base the answer on what they say. " +
  "Answer in the same language as the question. Never call a tool other than the search tool. " +
  "Reply in plain text using exactly these four lines and nothing else:\n" +
  "KEYS: <letters of correct options separated by commas, or - if there are no options>\n" +
  "ANSWER: <the correct answer, short and precise>\n" +
  "EXPLANATION: <1-3 sentences explaining why>\n" +
  "CONFIDENCE: <high|medium|low>";

function stripCitations(text: string): string {
  return text.replace(/【[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
}

function field(text: string, name: string): string {
  const match = text.match(new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.+)$`, "im"));
  return match ? stripCitations(match[1].replace(/\*\*/g, "")) : "";
}

const STOP_WORDS = new Set([
  "какой", "какая", "какое", "какие", "который", "которая", "которое", "которые", "является",
  "являются", "выберите", "укажите", "отметьте", "правильный", "правильные", "ответ", "ответы",
  "что", "это", "для", "при", "или", "как", "под", "над", "его", "ее", "их", "вариант",
  "which", "what", "the", "and", "are", "following", "select", "choose", "correct", "answer",
]);

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [])
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => w.slice(0, 5));
}

type SourceKind = "wikipedia" | "pubmed" | "europepmc";

interface Doc {
  kind: SourceKind;
  title: string;
  url: string;
  text: string;
  englishTitle?: string;
}

const UA = { "User-Agent": "pdf-mcq-study-app/1.0 (educational)" };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

interface WikiApiPage {
  title: string;
  extract?: string;
  langlinks?: { lang: string; title: string }[];
}

async function wikiSearch(lang: "ru" | "en", query: string, limit = 3): Promise<Doc[]> {
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
      exintro: "0",
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
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pg.title.replace(/ /g, "_"))}`,
      text: `${pg.title}. ${pg.extract ?? ""}`,
      englishTitle: lang === "en" ? pg.title : pg.langlinks?.find((l) => l.lang === "en")?.title,
    }));
}

function xmlText(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

async function pubmedSearch(query: string): Promise<Doc[]> {
  const eutils = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const ids = await getJson<{ esearchresult?: { idlist?: string[] } }>(
    `${eutils}/esearch.fcgi?${new URLSearchParams({ db: "pubmed", term: query, retmax: "4", retmode: "json", sort: "relevance" })}`,
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
        ? { kind: "pubmed" as const, title: `${title} (PubMed)`, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, text: `${title}. ${abstract}` }
        : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

async function europePmcSearch(query: string): Promise<Doc[]> {
  const data = await getJson<{
    resultList?: { result?: { id?: string; source?: string; pmid?: string; title?: string; abstractText?: string }[] };
  }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({
      query,
      format: "json",
      resultType: "core",
      pageSize: "4",
    })}`,
  );
  return (data?.resultList?.result ?? [])
    .filter((r) => r.id && r.source && r.title)
    .map((r) => ({
      kind: "europepmc" as const,
      title: `${xmlText(r.title ?? "")} (Europe PMC)`,
      url: `https://europepmc.org/article/${r.source}/${r.id}`,
      text: `${xmlText(r.title ?? "")}. ${xmlText(r.abstractText ?? "")}`,
    }));
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

async function freeLookup(question: string, options: { key: string; text: string }[]): Promise<Response> {
  try {
    if (options.length === 0) return Response.json({ error: "no_answer" }, { status: 404 });

    const lang = /[а-яё]/i.test(question) ? "ru" : "en";
    const questionQuery = keywords(question, 5);
    const questionStems = Array.from(new Set(stems(question)));
    if (!questionQuery || questionStems.length === 0) return Response.json({ error: "no_answer" }, { status: 404 });

    const [questionDocs, ...optionDocLists] = await Promise.all([
      wikiSearch(lang, questionQuery),
      ...options.slice(0, 6).map((o) => wikiSearch(lang, o.text, 1).catch(() => [] as Doc[])),
    ]);

    const generalText = questionDocs.map((d) => d.text).join(" ").toLowerCase();
    const generalStems = new Set(stems(generalText));

    const scored = options.slice(0, 6).map((option, i) => {
      const own = optionDocLists[i]?.[0];
      const ownScore = own ? coverage(questionStems, new Set(stems(own.text))) : 0;
      const phrase = option.text.toLowerCase().replace(/\s+/g, " ").trim();
      const phraseHit = phrase.length >= 4 && generalText.includes(phrase) ? 1 : 0;
      const optionStems = Array.from(new Set(stems(option.text)));
      const generalScore = Math.max(phraseHit, coverage(optionStems, generalStems));
      return { option, own, score: ownScore + 0.5 * generalScore };
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best || best.score < 0.4 || (second && best.score - second.score < 0.15)) {
      return Response.json({ error: "no_answer" }, { status: 404 });
    }

    const englishTerms = [best.own?.englishTitle, questionDocs[0]?.englishTitle].filter((x): x is string => !!x).join(" ");
    const scientific = englishTerms
      ? (await Promise.all([pubmedSearch(englishTerms), europePmcSearch(englishTerms)])).flat()
      : [];

    const seen = new Set<string>();
    const sources = [best.own, ...questionDocs, ...scientific]
      .filter((d): d is Doc => !!d)
      .filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)))
      .slice(0, 5)
      .map((d) => ({ title: d.title, url: d.url, kind: d.kind }));

    return Response.json({
      keys: [best.option.key],
      answerText: best.option.text,
      explanation: `Ответ подобран автоматически по открытым медицинским источникам (${sources.map((x) => x.title).slice(0, 2).join("; ")}): статья об этом варианте лучше всего совпадает с формулировкой вопроса. Проверьте по ссылкам.`,
      confidence: best.score >= 1 ? "medium" : "low",
      mode: "free",
      sources,
    });
  } catch (err) {
    console.error("[answer] free lookup failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const apiKey = process.env.GROQ_API_KEY;
  const { question, options } = parsed.data;

  const free = await freeLookup(question, options);
  if (free.ok || !apiKey) return free;

  const optionBlock = options.length
    ? options.map((o) => `${o.key}) ${o.text}`).join("\n")
    : "(no options — open answer: give the exact term)";

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question:\n${question}\n\nOptions:\n${optionBlock}\n\nIf several options can be correct, list all of them.`,
          },
        ],
        tools: [{ type: "browser_search" }],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (res.status === 429) return Response.json({ error: "rate_limit" }, { status: 429 });
    if (!res.ok) {
      console.error("[answer] groq error:", res.status, await res.text().catch(() => ""));
      return free;
    }

    const data = (await res.json()) as GroqResponse;
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";

    const validKeys = new Set(options.map((o) => o.key.toUpperCase()));
    const keys = Array.from(
      new Set(
        field(content, "KEYS")
          .toUpperCase()
          .split(/[^A-ZА-Я0-9]+/)
          .filter((k) => validKeys.has(k)),
      ),
    );

    const answerText = field(content, "ANSWER");
    if (!answerText && keys.length === 0) {
      return Response.json({ error: "Lookup failed" }, { status: 502 });
    }

    const confidenceRaw = field(content, "CONFIDENCE").toLowerCase();
    const confidence = ["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "medium";

    const seen = new Set<string>();
    const sources = (message?.executed_tools ?? [])
      .flatMap((t) => t.search_results?.results ?? [])
      .filter((s): s is { title?: string; url: string } => !!s.url && /^https?:\/\//.test(s.url))
      .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
      .slice(0, 5)
      .map((s) => ({ title: s.title || new URL(s.url).hostname, url: s.url }));

    return Response.json({
      keys,
      answerText,
      explanation: field(content, "EXPLANATION"),
      confidence,
      mode: "ai",
      sources,
    });
  } catch (err) {
    console.error("[answer] lookup failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
