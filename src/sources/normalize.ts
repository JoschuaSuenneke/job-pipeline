// Normalisation helpers shared by adapters: HTML to text, work mode, salary ranges.
import type { WorkMode } from "../core/schema.ts";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

/** Decodes the handful of HTML entities job boards actually use. `&amp;` last, so `&amp;lt;` stays literal. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Turns job-board HTML into readable plain text with paragraph breaks. */
export function htmlToText(html = ""): string {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<br\s*\/?>|<\/(?:p|li|div|h\d|ul|ol|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const REMOTE =
  /\b(remote|fully remote|homeoffice|home office|home-office|100\s*%\s*(remote|mobil)|ortsunabh|deutschlandweit|work from anywhere)\b/i;
const HYBRID = /\b(hybrid|hybride?s? arbeiten|teilweise remote|mobiles arbeiten)\b/i;

/** Classifies work mode from structured hints first, then from free text. */
export function detectWorkMode(...hints: (string | boolean | null | undefined)[]): WorkMode {
  const text = hints.filter((h): h is string => typeof h === "string").join(" ");
  if (hints.includes(true) || /^remote$/i.test(text.trim())) return "remote";
  if (HYBRID.test(text)) return "hybrid";
  if (REMOTE.test(text)) return "remote";
  if (/\b(on-?site|in office|vor ort|präsenz)\b/i.test(text)) return "onsite";
  return "unknown";
}

export interface Salary {
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
}

const CURRENCY: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  eur: "EUR",
  usd: "USD",
  gbp: "GBP",
  chf: "CHF",
};

function amount(raw: string, k: string | undefined): number {
  const digits = raw.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number.parseFloat(digits);
  return k ? n * 1000 : n;
}

/** Finds a yearly salary range like "€60,000 – €75,000", "60k-75k EUR" or "EUR 55.000 bis 65.000" in text. */
export function parseSalary(text: string): Salary {
  const m = text.match(
    /(€|\$|£|EUR|USD|GBP|CHF)?\s?(\d{2,3}(?:[.,]\d{3})?)\s?(k)?\s*(?:-|–|—|to|bis)\s*(€|\$|£|EUR|USD|GBP|CHF)?\s?(\d{2,3}(?:[.,]\d{3})?)\s?(k)?\s*(€|EUR|USD|GBP|CHF)?/i,
  );
  if (!m) return {};
  const cur = (m[1] ?? m[4] ?? m[7])?.toLowerCase();
  if (!cur) return {};
  const min = amount(m[2] as string, m[3] ?? m[6]);
  const max = amount(m[5] as string, m[6] ?? m[3]);
  if (!(min >= 10_000 && max >= min && max < 1_000_000)) return {};
  return { salaryMin: min, salaryMax: max, currency: CURRENCY[cur] ?? cur.toUpperCase() };
}

/** Builds a Salary from structured numbers, ignoring hourly/monthly rates that would distort the floor check. */
export function salaryFrom(
  min?: number | null,
  max?: number | null,
  currency?: string | null,
  period?: string | null,
): Salary {
  if (period && !/year|annual|jahr/i.test(period)) return {};
  if (!min && !max) return {};
  return {
    salaryMin: min ?? undefined,
    salaryMax: max ?? min ?? undefined,
    currency: currency?.toUpperCase() || undefined,
  };
}

/** ISO date string or undefined for anything unparseable (epoch ms, RFC 2822 and ISO all work). */
export function isoDate(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const d = new Date(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
