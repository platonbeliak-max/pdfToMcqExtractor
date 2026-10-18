"use client";

import useSWR from "swr";
import type { StructuredQuestion } from "@/types/question";

export const BUILT_IN_BANKS = [
  { id: "etest2", label: "bankEtest2" },
  { id: "physexam4", label: "bankPhysExam4" },
  { id: "physiology", label: "bankPhysiology" },
  { id: "anatomy", label: "bankAnatomy" },
] as const;

export type BuiltInBankId = (typeof BUILT_IN_BANKS)[number]["id"];
export type BaseId = BuiltInBankId | "mine";

const fetchBank = async (url: string): Promise<StructuredQuestion[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { questions: StructuredQuestion[] }).questions;
};

const SWR_OPTS = { revalidateOnFocus: false, revalidateIfStale: false } as const;

/** Only the selected bank is downloaded; previously opened banks stay cached for instant switching. */
export function useBuiltInBank(id: BaseId) {
  return useSWR(id === "mine" ? null : `/banks/${id}.json`, fetchBank, SWR_OPTS);
}
