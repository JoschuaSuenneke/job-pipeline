// Checks generated text (CV, cover note, form answers) against the user's confirmed facts.
// It cannot prove a sentence true; it catches the claims that are easiest to invent and hardest to defend:
// numbers, tools, employers and job titles that no confirmed fact mentions.
import type { Fact } from "../core/schema.ts";

export type IssueKind = "number" | "tool" | "organisation" | "style" | "length";

export interface ClaimIssue {
  kind: IssueKind;
  /** The exact snippet that triggered the issue. */
  text: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  words: number;
  issues: ClaimIssue[];
}

export interface CheckOptions {
  /** Word limit (config.documents.coverLetterMaxWords for cover notes). */
  maxWords?: number;
  /**
   * Text that may be quoted freely: the target company, the job title and posting, the salary ask, the start date.
   * Numbers and names that appear here are not claims about the user.
   */
  context?: string;
  /** Extra terms that are always fine (product names of the user's own projects, for example). */
  allow?: string[];
}

/** Acronyms and words that look like tools but are generic. */
const GENERIC = new Set(
  [
    "AI",
    "KI",
    "ML",
    "API",
    "APIs",
    "B2B",
    "B2C",
    "SaaS",
    "CRM",
    "KPI",
    "KPIs",
    "OKR",
    "OKRs",
    "ROI",
    "UX",
    "UI",
    "HR",
    "IT",
    "CEO",
    "CTO",
    "COO",
    "CFO",
    "CV",
    "PDF",
    "EU",
    "DACH",
    "USA",
    "UK",
    "GmbH",
    "AG",
    "SE",
    "MVP",
    "PM",
    "PO",
    "QA",
    "LLM",
    "LLMs",
    "GTM",
    "SEO",
    "SMB",
    "SME",
    "NGO",
    "CX",
    "BI",
    "ERP",
    "ID",
    "OK",
    "FAQ",
    "PhD",
    "MBA",
    "B.A.",
    "M.A.",
    "B.Sc.",
    "M.Sc.",
    "LinkedIn",
    "GitHub",
    "E-Mail",
    "TV",
    "PR",
    "NRW",
    "DE",
    "EN",
  ].map((w) => w.toLowerCase()),
);

/** Turns "20.500", "20,500+", "~4x" or "11,8" into a comparable core like "20500", "4x", "11.8". */
export function normaliseNumber(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[~≈+\s]/g, "")
    .replace(/[.,]+$/, "");
  const suffix = /[%x]$/.test(s) ? (s.at(-1) as string) : "";
  if (suffix) s = s.slice(0, -1);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(",", ".");
  return s + suffix;
}

const NUMBER = /(?<![\w.])[~≈]?\d[\d.,]*\s?(?:%|x\b)?\+?/g;

function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => m[0].trim()).filter((n) => /\d/.test(n));
}

/** Tool-like tokens: CamelCase (PostHog), dotted names (Next.js), ALLCAPS (SQL), or with digits (n8n). */
const TOOL = /\b(?:[A-Z][a-z]+[A-Z][A-Za-z]*|[A-Za-z]+\.(?:js|io|ai|ts|py)|[A-Z]{2,6}|[a-z]+\d+[a-z]*)\b/g;

/** Capitalised name after "at", "bei", "for", "with", "für": the organisation a claim is attached to. */
const ORG = /\b(?:[Aa]t|[Bb]ei|[Ff]or|[Ff]ür|[Ww]ith|[Mm]it)\s+((?:[A-Z][\w&.-]*)(?:\s+[A-Z][\w&.-]*){0,3})/g;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
}

/**
 * Flags claims in `text` that no confirmed fact supports. Unconfirmed facts never count as support.
 * Returns ok=false when anything needs the user's attention.
 */
export function checkClaims(text: string, facts: Fact[], options: CheckOptions = {}): CheckResult {
  const support = facts
    .filter((f) => f.confirmed)
    .map((f) => `${f.text} ${f.tags.join(" ")}`)
    .join("\n");
  const allowed = `${support}\n${options.context ?? ""}\n${(options.allow ?? []).join("\n")}`;
  const allowedLower = allowed.toLowerCase();
  const allowedNumbers = new Set(numbersIn(allowed).map(normaliseNumber));
  const issues: ClaimIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: ClaimIssue) => {
    const key = `${issue.kind}:${issue.text.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  };

  for (const raw of numbersIn(text)) {
    const n = normaliseNumber(raw);
    if (!allowedNumbers.has(n)) {
      add({
        kind: "number",
        text: raw,
        message: `"${raw}" is not in any confirmed fact or the job context.`,
      });
    }
  }

  for (const m of text.matchAll(TOOL)) {
    const token = m[0];
    if (GENERIC.has(token.toLowerCase()) || allowedLower.includes(token.toLowerCase())) continue;
    add({
      kind: "tool",
      text: token,
      message: `"${token}" looks like a tool or product no confirmed fact mentions.`,
    });
  }

  for (const m of text.matchAll(ORG)) {
    // "At Google I grew …": the pronoun I is not part of the name.
    const name = (m[1] ?? "").replace(/[.,]$/, "").replace(/(\s+I)+$/, "");
    const first = name.split(/\s+/)[0] ?? "";
    if (!name || allowedLower.includes(name.toLowerCase()) || allowedLower.includes(first.toLowerCase()))
      continue;
    add({
      kind: "organisation",
      text: name,
      message: `"${name}" is named as an employer or client but no fact mentions it.`,
    });
  }

  if (/—|\s–\s/.test(text)) {
    add({
      kind: "style",
      text: "—",
      message: "Uses an em dash or spaced dash; rewrite with a full stop, comma or colon.",
    });
  }

  const words = wordCount(text);
  if (options.maxWords !== undefined && words > options.maxWords) {
    add({
      kind: "length",
      text: `${words} words`,
      message: `${words} words; the limit is ${options.maxWords}.`,
    });
  }

  return { ok: issues.length === 0, words, issues };
}
