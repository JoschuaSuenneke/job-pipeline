// Builds a CV from confirmed facts and, when a job is given, picks and orders bullets by relevance.
import type { Config, Fact } from "../core/schema.ts";
import { type Cv, type CvBullet, type CvEntry, parseHeader, type TargetJob } from "./model.ts";

export interface BuildCvOptions {
  job?: TargetJob;
  language?: string;
  /** Total experience/education bullets across all entries. Every entry keeps at least one. */
  maxBullets?: number;
  maxSkills?: number;
}

const STOPWORDS = new Set(
  (
    "the and for with from that this you your our are was were will have has into over per und der die das mit für " +
    "von eine einer einen ein ist sind wir ihr bei auf aus als oder auch sowie sich nicht dich dein deine wie zum zur"
  ).split(" "),
);

/** Lowercase word tokens of length >= 3, without stopwords. */
export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Relevance of one fact to the job: shared words, plus a bonus per tag that appears in the job text,
 * plus a bonus when a tag names one of the user's target role families that the job title matches.
 */
export function scoreFact(
  fact: Fact,
  jobTokens: Set<string>,
  jobText: string,
  roleFamilies: string[],
): number {
  let score = 0;
  for (const t of tokenize(fact.text)) if (jobTokens.has(t)) score += 1;
  const lowerJob = jobText.toLowerCase();
  for (const tag of fact.tags) {
    const t = tag.toLowerCase();
    if (t === "header") continue;
    if (lowerJob.includes(t)) score += 3;
    if (roleFamilies.some((r) => r.toLowerCase() === t && lowerJob.includes(t))) score += 2;
  }
  return score;
}

/** "de" → "German" (or "Deutsch" when the CV is in German). Falls back to the code. */
export function languageName(code: string, inLanguage: string): string {
  try {
    return new Intl.DisplayNames([inLanguage], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function entryOrder(facts: Fact[]): string[] {
  const order: string[] = [];
  for (const f of facts) if (f.entry && !order.includes(f.entry)) order.push(f.entry);
  return order;
}

function buildEntries(
  facts: Fact[],
  section: "experience" | "education",
  score: (f: Fact) => number,
): CvEntry[] {
  const inSection = facts.filter(
    (f) => f.section === section || (section === "experience" && f.section === "achievement"),
  );
  const entries: CvEntry[] = [];
  for (const id of entryOrder(inSection)) {
    const header = inSection.find((f) => f.entry === id && f.tags.includes("header"));
    if (!header || header.section !== section) continue;
    const bullets: CvBullet[] = inSection
      .filter((f) => f.entry === id && !f.tags.includes("header"))
      .map((f) => ({ factId: f.id, text: f.text, score: score(f) }));
    entries.push({ entry: id, headerFactId: header.id, ...parseHeader(header.text), bullets });
  }
  return entries;
}

/** Keeps the best `max` bullets overall (at least one per entry), then orders each entry by score. */
function trimBullets(entries: CvEntry[], max: number): void {
  const all = entries.flatMap((e, i) => e.bullets.map((b, j) => ({ b, i, j })));
  const keep = new Set<CvBullet>();
  for (const e of entries) {
    const best = [...e.bullets].sort((a, b) => b.score - a.score)[0];
    if (best) keep.add(best);
  }
  for (const { b } of all.sort((x, y) => y.b.score - x.b.score || x.i - y.i || x.j - y.j)) {
    if (keep.size >= max) break;
    keep.add(b);
  }
  for (const e of entries) {
    const original = e.bullets.map((b) => b.factId);
    e.bullets = e.bullets
      .filter((b) => keep.has(b))
      .sort((a, b) => b.score - a.score || original.indexOf(a.factId) - original.indexOf(b.factId));
  }
}

/**
 * Builds a CV from confirmed facts only. With a job, bullets and skills are ranked by overlap with the job's
 * title and description and the user's role families; without one, the CV keeps the facts' own order.
 */
export function buildCv(facts: Fact[], config: Config, options: BuildCvOptions = {}): Cv {
  const confirmed = facts.filter((f) => f.confirmed);
  const job = options.job;
  const jobText = job ? `${job.title}\n${job.description ?? ""}` : "";
  const jobTokens = tokenize(jobText);
  const roles = config.targets.roles;
  const score = (f: Fact) => (job ? scoreFact(f, jobTokens, jobText, roles) : 0);

  const experience = buildEntries(confirmed, "experience", score);
  const education = buildEntries(confirmed, "education", score);
  trimBullets(experience, options.maxBullets ?? 12);

  const skillFacts = confirmed.filter((f) => f.section === "skill");
  const rankedSkills = job ? [...skillFacts].sort((a, b) => score(b) - score(a)) : skillFacts;
  const skills = rankedSkills.slice(0, options.maxSkills ?? 12);

  const contactFacts = confirmed.filter((f) => f.section === "contact");
  const { candidate } = config;
  const contact = [
    candidate.email,
    candidate.phone,
    candidate.home,
    ...contactFacts.map((f) => f.text),
  ].filter((c): c is string => Boolean(c));

  const used = [
    ...experience.flatMap((e) => [e.headerFactId, ...e.bullets.map((b) => b.factId)]),
    ...education.flatMap((e) => [e.headerFactId, ...e.bullets.map((b) => b.factId)]),
    ...skills.map((f) => f.id),
    ...contactFacts.map((f) => f.id),
  ];

  const notes: string[] = [];
  if (job) {
    const top = experience.flatMap((e) => e.bullets).filter((b) => b.score > 0).length;
    notes.push(`${top} bullets match "${job.title}" directly; the rest keep each entry readable.`);
  }
  const unconfirmed = facts.length - confirmed.length;
  if (unconfirmed > 0) notes.push(`${unconfirmed} unconfirmed facts were left out.`);

  const language = options.language ?? config.documents.cvLanguages[0] ?? "en";
  return {
    language,
    name: candidate.name,
    contact,
    experience,
    education,
    skills: skills.map((f) => f.text),
    languages: candidate.languages.map((l) => `${languageName(l.code, language)} (${l.level})`),
    factIds: used,
    notes,
  };
}
