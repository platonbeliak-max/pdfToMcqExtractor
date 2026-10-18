export const BLANK = /_{2,}|…{2,}|\.{4,}/g;

const stripQuotes = (s: string) => s.replace(/^[\s«"“'„]+|[\s»"”'.,;:!?]+$/g, "").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const looseRe = (s: string) => escapeRe(s.replace(/[«»"“”„]/g, "").trim()).replace(/\s+/g, "\\s+");

export const blankCount = (text: string) => (text.match(BLANK) ?? []).length;

/** Lines the answer sentence up against the question's fixed text and returns what fills each blank. */
function alignToTemplate(text: string, answer: string): string[] | null {
  const fixed = text.split(BLANK);
  const plain = answer.replace(/[«»"“”„]/g, "");
  const pattern = fixed
    .map((part, i) => {
      const lit = looseRe(part);
      if (i === 0) return `^\\s*${lit}\\s*`;
      const isLast = i === fixed.length - 1;
      if (isLast) return lit ? `(.+?)\\s*${lit}[\\s.,;:!?]*$` : `(.+?)[\\s.,;:!?]*$`;
      return `(.+?)${lit ? `\\s*${lit}` : "\\s+"}\\s*`;
    })
    .join("");
  const m = plain.match(new RegExp(pattern, "is"));
  if (!m) return null;
  const words = m.slice(1).map(stripQuotes);
  return words.every(Boolean) ? words : null;
}

/** The word expected in each `___` of a fill-in question, or null when they can't be derived reliably. */
export function clozeAnswers(text: string, answer: string): string[] | null {
  const count = blankCount(text);
  if (!count || !answer) return null;
  const quoted = [...answer.matchAll(/«([^»]+)»|"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
  if (quoted.length === count) return quoted;
  const aligned = alignToTemplate(text, answer);
  if (aligned?.length === count) return aligned;
  const parts = answer.split(/\s*[;,]\s*/).map(stripQuotes).filter(Boolean);
  if (parts.length === count) return parts;
  const joined = answer.split(/\s*[;,]\s*|\s+(?:и|or|and)\s+/i).map(stripQuotes).filter(Boolean);
  if (joined.length === count) return joined;
  if (count === 1 && !quoted.length) return [stripQuotes(answer)];
  return null;
}
