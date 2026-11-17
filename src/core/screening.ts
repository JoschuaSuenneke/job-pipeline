// Deterministic first-pass screening: hard rules from the config, then a transparent fit score.
// The agent reads the full description afterwards; this pass only removes the obvious misfits cheaply.
import { remoteOpenTo } from "./regions.ts";
import type { Config, RawJob } from "./schema.ts";

export type Verdict =
  | { decision: "keep"; score: number; reasons: string[] }
  | { decision: "drop" | "park"; reason: string };

const SENIOR = /\b(senior|sr\.?|lead|principal|staff|head of|director|vp|chief(?! of staff))\b/i;
/** Not a salaried position: volunteer, internship, working student, apprenticeship. */
const NOT_A_JOB =
  /\b(unpaid|volunteer|ehrenamt\w*|intern(ship)?|praktik\w*|werkstudent\w*|working student|azubi|ausbildung|apprentice\w*|trainee)\b/i;
const PART_TIME = /\b(part[- ]time|teilzeit|minijob|\d{1,2}\s*h\/woche)\b/i;
const YEARS = /(\d{1,2})\s*\+?\s*(?:years?|jahre?n?)\b/gi;

export function maxYearsRequired(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(YEARS)) {
    const n = Number(m[1]);
    if (n <= 15) max = Math.max(max ?? 0, n);
  }
  return max;
}

function matchesAny(text: string, needles: string[]): string | undefined {
  const t = text.toLowerCase();
  return needles.find((n) => n && t.includes(n.toLowerCase()));
}

/** Office days a role allows given the candidate's commute tiers, or null when the place is not covered. */
export function allowedOfficeDays(config: Config, location: string): number | null {
  for (const tier of config.location.tiers) {
    if (matchesAny(location, tier.places)) return tier.maxOfficeDays;
  }
  return null;
}

export function screen(job: RawJob, config: Config): Verdict {
  const { targets, rules, compensation, location } = config;
  const text = `${job.title}\n${job.description}`;

  const blocked = matchesAny(job.company, rules.blocklist);
  if (blocked) return { decision: "drop", reason: `blocklist: ${blocked}` };

  const excluded = targets.excludeTitlePatterns.find((p) => new RegExp(p, "i").test(job.title));
  if (excluded) return { decision: "drop", reason: `title excluded by pattern ${excluded}` };

  const notAJob = job.title.match(NOT_A_JOB);
  if (notAJob && !targets.seniority.includes("intern")) {
    return { decision: "drop", reason: `not a salaried role ("${notAJob[0]}")` };
  }
  const partTime = job.title.match(PART_TIME);
  if (partTime && !targets.partTime) return { decision: "drop", reason: `part-time ("${partTime[0]}")` };

  const wantsSenior = targets.seniority.some((s) => s === "senior" || s === "lead");
  if (!wantsSenior && SENIOR.test(job.title)) return { decision: "park", reason: "senior title" };

  const years = maxYearsRequired(job.description);
  if (years !== null && years > targets.maxYearsRequired) {
    return { decision: "drop", reason: `asks for ${years}+ years (limit ${targets.maxYearsRequired})` };
  }

  // Pay in another currency is not comparable without an exchange rate; the agent judges those.
  const pay = !job.currency || job.currency === compensation.currency ? job.salaryMax : undefined;
  if (pay !== undefined && pay < compensation.floor) {
    return { decision: "drop", reason: `pay ${pay} below floor ${compensation.floor}` };
  }

  const reasons: string[] = [];
  let score = 0;

  const role = matchesAny(job.title, targets.roles) ?? matchesAny(text, targets.keywords);
  if (!role) return { decision: "drop", reason: "no target role or keyword in title/description" };
  const inTitle = Boolean(matchesAny(job.title, targets.roles));
  score += inTitle ? 40 : 20;
  reasons.push(inTitle ? `title matches "${role}"` : `description mentions "${role}"`);

  if (job.workMode === "remote") {
    if (!remoteOpenTo(job.location, location.remoteCountries))
      return { decision: "drop", reason: `remote, but not from ${location.remoteCountries.join("/")}` };
    score += 25;
    reasons.push("remote");
  } else {
    const days = allowedOfficeDays(config, job.location);
    if (days === null)
      return { decision: "drop", reason: `location "${job.location}" outside your commute tiers` };
    score += days >= 3 ? 25 : 15;
    reasons.push(`commutable (${days} office days ok)`);
  }

  if (pay !== undefined) {
    score += pay >= compensation.ask ? 15 : 8;
    reasons.push(`pay listed up to ${pay}`);
  }
  if (years !== null && years <= 2) {
    score += 10;
    reasons.push(`asks for ${years} years`);
  }
  if (job.description.length > 400) score += 5;

  return { decision: "keep", score: Math.min(100, score), reasons };
}
