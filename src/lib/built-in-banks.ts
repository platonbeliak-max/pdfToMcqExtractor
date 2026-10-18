"use client";

import useSWR from "swr";
import type { StructuredQuestion } from "@/types/question";
import { pruneBank, repairQuestion } from "@/lib/stored-repair";

export const BUILT_IN_BANKS = [
  { id: "physiology", label: "bankPhysiology" },
  { id: "anatomy", label: "bankAnatomy" },
] as const;

export type BuiltInBankId = (typeof BUILT_IN_BANKS)[number]["id"];
export type BaseId = BuiltInBankId | "mine";

const fetchBank = async (url: string): Promise<StructuredQuestion[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { questions } = (await res.json()) as { questions: StructuredQuestion[] };
  return pruneBank(questions.map(repairQuestion));
};

/** Bump whenever public/banks/anatomy.json is rebuilt so returning visitors get the new copy. */
const ANATOMY_SEED_VERSION = "anatomy-2026-10-06";
const SEED_VERSION_KEY = "mcq_platform_seed_version";
const ANATOMY_DOC_ID = "bank-anatomy";

const normText = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();

/**
 * Puts the curated anatomy bank into the saved bank on entry. Older uploaded copies of the same
 * questions are replaced, so stale answers and screenshot "figures" do not linger next to the fixed ones.
 * Returns null when the current seed is already in place.
 */
export async function seedAnatomyBank(saved: StructuredQuestion[]): Promise<StructuredQuestion[] | null> {
  const seeded = localStorage.getItem(SEED_VERSION_KEY) === ANATOMY_SEED_VERSION;
  if (seeded && saved.some((q) => q.source?.documentId === ANATOMY_DOC_ID)) return null;
  const bank = await fetchBank("/banks/anatomy.json");
  const bankTexts = new Set(bank.map((q) => normText(q.question.text)));
  const others = saved.filter(
    (q) => q.source?.documentId !== ANATOMY_DOC_ID && !bankTexts.has(normText(q.question.text))
  );
  localStorage.setItem(SEED_VERSION_KEY, ANATOMY_SEED_VERSION);
  return [...bank, ...others];
}

/** Both built-in banks are fetched as soon as the app opens, so switching between them is instant. */
export function useBuiltInBanks() {
  const physiology = useSWR("/banks/physiology.json", fetchBank, { revalidateOnFocus: false, revalidateIfStale: false });
  const anatomy = useSWR("/banks/anatomy.json", fetchBank, { revalidateOnFocus: false, revalidateIfStale: false });
  return { physiology, anatomy } as const;
}
