// Domain schemas. Every boundary (config files, API input, adapter output) is parsed with these.
import { z } from "zod";

export const JOB_STATUSES = [
  "new", // sourced, not screened yet
  "drafted", // screened; CV and cover note drafted; waiting for the user's go
  "approved", // the user said go for this exact job
  "applied",
  "conversation", // a human at the company replied
  "interview",
  "offer",
  "accepted",
  "rejected",
  "dropped", // screened out (reason in the event log)
  "parked", // kept for later (senior title, second role at a company, ...)
] as const;
export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;

export const WorkMode = z.enum(["remote", "hybrid", "onsite", "unknown"]);
export type WorkMode = z.infer<typeof WorkMode>;

export const ApplyMethod = z.enum(["form", "email", "easy_apply", "unknown"]);
export type ApplyMethod = z.infer<typeof ApplyMethod>;

/** What a source adapter returns. Normalised before it touches the database. */
export const RawJob = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  url: z.url(),
  location: z.string().default(""),
  workMode: WorkMode.default("unknown"),
  description: z.string().default(""),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  /** ISO 4217 code when the posting states it. Pay is only compared when it matches the user's currency. */
  currency: z.string().optional(),
  postedAt: z.string().optional(),
  applyMethod: ApplyMethod.default("unknown"),
  applyEmail: z.string().optional(),
  source: z.string(),
});
export type RawJob = z.infer<typeof RawJob>;
export type RawJobInput = z.input<typeof RawJob>;

export const FACT_SECTIONS = [
  "contact",
  "experience",
  "education",
  "skill",
  "achievement",
  "answer",
  "constraint",
] as const;

/** A fact about the user. Nothing reaches a CV, cover note or form answer unless it traces to a confirmed fact. */
export const Fact = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  section: z.enum(FACT_SECTIONS),
  text: z.string().min(1),
  /** Where it came from, e.g. "cv:resume.pdf", "user:2026-11-17", "linkedin-export". */
  source: z.string(),
  confirmed: z.boolean().default(false),
  /** Role families or keywords this fact is strong evidence for. Used to pick CV bullets per job. */
  tags: z.array(z.string()).default([]),
  /** For experience/education facts: which entry they belong to, e.g. "acme-2023". */
  entry: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

const CommuteTier = z.object({
  label: z.string(),
  places: z.array(z.string()),
  /** Maximum office days per week for roles in these places. 5 = daily commute is fine, 0 = remote only. */
  maxOfficeDays: z.number().min(0).max(5),
});

const Consents = z.object({
  privacy: z.boolean().default(true),
  talentPool: z.boolean().default(false),
  termsOfUse: z.boolean().default(false),
  backgroundCheck: z.boolean().default(false),
  recording: z.boolean().default(false),
});

/** job-pipeline.config.yaml. Everything personal lives here, never in code. */
export const Config = z.object({
  version: z.literal(1),
  candidate: z.object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().optional(),
    home: z.string().min(1),
    country: z.string().length(2),
    /** How the user may work where they apply, in their words: "US citizen", "needs H-1B sponsorship", "EU citizen". */
    workAuthorization: z.string().optional(),
    languages: z.array(z.object({ code: z.string(), level: z.string() })).default([]),
  }),
  targets: z.object({
    roles: z.array(z.string()).min(1),
    keywords: z.array(z.string()).default([]),
    seniority: z.array(z.enum(["intern", "junior", "mid", "senior", "lead"])).default(["junior", "mid"]),
    excludeTitlePatterns: z.array(z.string()).default([]),
    maxYearsRequired: z.number().default(5),
    /** Keep part-time roles. Off by default: most people searching full-time don't want them. */
    partTime: z.boolean().default(false),
  }),
  location: z.object({
    remoteCountries: z.array(z.string()).default([]),
    tiers: z.array(CommuteTier).default([]),
  }),
  compensation: z.object({
    currency: z.string().default("EUR"),
    floor: z.number(),
    ask: z.number(),
    preferFixed: z.boolean().default(true),
  }),
  rules: z
    .object({
      blocklist: z.array(z.string()).default([]),
      oneRolePerCompany: z.boolean().default(true),
      dailyApplicationLimit: z.number().int().positive().default(20),
      consents: Consents.default(Consents.parse({})),
      /** The agent may put application emails into the user's Drafts folder. Nothing is ever sent. */
      emailDrafts: z.boolean().default(true),
    })
    .default({
      blocklist: [],
      oneRolePerCompany: true,
      dailyApplicationLimit: 20,
      consents: Consents.parse({}),
      emailDrafts: true,
    }),
  sources: z
    .object({
      enabled: z.array(z.string()).default(["ats", "remote-boards"]),
      companies: z.array(z.object({ name: z.string(), ats: z.string(), slug: z.string() })).default([]),
    })
    .default({ enabled: ["ats", "remote-boards"], companies: [] }),
  documents: z
    .object({
      cvTemplate: z.string().default("clean"),
      cvLanguages: z.array(z.string()).default(["en"]),
      coverLetterMaxWords: z.number().default(220),
    })
    .default({ cvTemplate: "clean", cvLanguages: ["en"], coverLetterMaxWords: 220 }),
  mail: z
    .object({
      provider: z.enum(["none", "imap", "gmail", "microsoft"]).default("none"),
      fileConfirmations: z.boolean().default(false),
      folder: z.string().default("Job Pipeline"),
    })
    .default({ provider: "none", fileConfirmations: false, folder: "Job Pipeline" }),
  agent: z
    .object({ drivers: z.array(z.enum(["claude", "codex", "generic-mcp"])).default(["claude"]) })
    .default({ drivers: ["claude"] }),
});
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;
