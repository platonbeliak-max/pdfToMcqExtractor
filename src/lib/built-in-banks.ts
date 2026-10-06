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

/** Both built-in banks are fetched as soon as the app opens, so switching between them is instant. */
export function useBuiltInBanks() {
  const physiology = useSWR("/banks/physiology.json", fetchBank, { revalidateOnFocus: false, revalidateIfStale: false });
  const anatomy = useSWR("/banks/anatomy.json", fetchBank, { revalidateOnFocus: false, revalidateIfStale: false });
  return { physiology, anatomy } as const;
}
