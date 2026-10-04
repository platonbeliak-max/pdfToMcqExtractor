import type { QuestionInstance } from "./types";
import { formulaDamageSignals, looksLikeFormula } from "./text";

/**
 * Subject adapters add terminology and validation on top of the universal
 * core. The core never branches on subject; adapters only contribute hints
 * and extra review issues through this interface.
 */
export interface SubjectAdapter {
  slug: string;
  name: string;
  /** Lower-case stems / terms (ru, en, la). */
  terms: string[];
  validate?: (q: QuestionInstance) => string[];
}

const physicsValidate = (q: QuestionInstance): string[] => {
  const out: string[] = [];
  const all = [q.stem, ...q.options.map((o) => o.text)].join(" ");
  if (looksLikeFormula(all) && formulaDamageSignals(all).length) out.push("PHYSICS_FORMULA_INTEGRITY");
  // Numeric options that differ only by exponent must keep their exponents.
  const nums = q.options.map((o) => o.text).filter((t) => /\d/.test(t));
  if (nums.length >= 2 && nums.some((t) => /10\s?-?\d/.test(t)) && !nums.some((t) => /10\s?[⁻^]/.test(t))) out.push("PHYSICS_EXPONENT_LOST");
  return out;
};

export const SUBJECT_ADAPTERS: SubjectAdapter[] = [
  {
    slug: "anatomy",
    name: "Анатомия",
    terms: ["кость", "мышц", "артери", "вена", "нерв", "сустав", "позвон", "череп", "бугор", "отросток", "борозд", "связк", "фасци", "os ", "musculus", "arteria", "nervus", "foramen", "processus", "tuberculum", "sulcus", "fossa", "ligamentum", "anatomy", "bone", "muscle"],
  },
  {
    slug: "physiology",
    name: "Физиология",
    terms: ["потенциал действия", "возбудим", "рефлекс", "гормон", "секреци", "гемостаз", "свертыван", "эритроцит", "лейкоцит", "тромбоцит", "плазм", "давлени", "дыхани", "минутный объем", "синапс", "рецептор", "физиолог", "фильтраци", "physiology", "action potential"],
  },
  {
    slug: "physics",
    name: "Физика",
    terms: ["напряжен", "частот", "длина волны", "сопротивлен", "ток", "магнитн", "электрическ", "энерги", "ультразвук", "рентген", "оптическ", "линз", "дифракц", "интерферен", "вязкост", "гц", "дж", "вт", "physics", "frequency", "wavelength", "voltage"],
    validate: physicsValidate,
  },
  {
    slug: "biology",
    name: "Биология",
    terms: ["клетк", "митоз", "мейоз", "хромосом", "ген", "наследован", "аллел", "генотип", "фенотип", "паразит", "эволюц", "органоид", "рибосом", "днк", "рнк", "biology", "cell", "chromosome"],
  },
  {
    slug: "biochemistry",
    name: "Биохимия",
    terms: ["фермент", "кофермент", "метаболизм", "гликолиз", "цикл кребса", "аминокислот", "липид", "белок", "нуклеотид", "витамин", "окислен", "атф", "biochemistry", "enzyme", "glycolysis"],
  },
  {
    slug: "histology",
    name: "Гистология",
    terms: ["эпители", "ткан", "гистолог", "соединительн", "хрящ", "микропрепарат", "окраск", "гематоксилин", "эозин", "базальная мембран", "histology", "epithelium", "tissue"],
  },
  {
    slug: "pharmacology",
    name: "Фармакология",
    terms: ["препарат", "доз", "фармако", "антибиотик", "блокатор", "агонист", "антагонист", "побочн", "противопоказ", "механизм действия", "pharmacology", "drug", "dose"],
  },
  {
    slug: "chemistry",
    name: "Химия",
    terms: ["раствор", "моль", "кислот", "основани", "окислительно", "реакци", "валентн", "ph", "буфер", "осмос", "chemistry", "molar"],
    validate: (q) => (looksLikeFormula(q.stem) && formulaDamageSignals(q.stem).length ? ["CHEMISTRY_FORMULA_INTEGRITY"] : []),
  },
];

export function detectSubject(instances: QuestionInstance[]): { slug: string; name: string; confidence: number } | null {
  const text = instances.map((q) => `${q.stem} ${q.options.map((o) => o.text).join(" ")}`).join(" ").toLowerCase();
  if (!text.trim()) return null;
  const scores = SUBJECT_ADAPTERS.map((a) => {
    let hits = 0;
    for (const t of a.terms) {
      let idx = text.indexOf(t);
      while (idx >= 0) {
        hits++;
        idx = text.indexOf(t, idx + t.length);
      }
    }
    return { a, hits };
  }).sort((x, y) => y.hits - x.hits);
  const [best, second] = scores;
  if (!best || best.hits < 3) return null;
  const confidence = Math.min(0.95, 0.4 + 0.6 * (best.hits - (second?.hits ?? 0)) / best.hits);
  return { slug: best.a.slug, name: best.a.name, confidence: Number(confidence.toFixed(2)) };
}

export function questionSubjectHints(q: QuestionInstance): string[] {
  const t = `${q.stem} ${q.options.map((o) => o.text).join(" ")}`.toLowerCase();
  return SUBJECT_ADAPTERS.filter((a) => a.terms.filter((term) => t.includes(term)).length >= 2).map((a) => a.slug);
}

export function adapterFor(slug: string | null | undefined): SubjectAdapter | null {
  return SUBJECT_ADAPTERS.find((a) => a.slug === slug) ?? null;
}
