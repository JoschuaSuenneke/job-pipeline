// Applicant-tracking-system boards: the public, embed-friendly endpoints companies publish their jobs on.
// One small fetch + one pure parse function per ATS. Parse functions are exported for fixture tests.
import { companyKey } from "../core/names.ts";
import type { Config, RawJobInput } from "../core/schema.ts";
import { type Fetch, getJson, getText, HttpError, mapLimit, postJson, tryJson, tryText } from "./http.ts";
import { detectWorkMode, htmlToText, isoDate, parseSalary, salaryFrom } from "./normalize.ts";
import type { SourceAdapter, SourceContext } from "./types.ts";

export type Company = Config["sources"]["companies"][number];
export const ATS_KINDS = [
  "ashby",
  "greenhouse",
  "lever",
  "workable",
  "smartrecruiters",
  "personio",
  "recruitee",
  "workday",
] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

const src = (c: Company) => `${c.ats}:${c.slug}`;

// ─── Ashby ──────────────────────────────────────────────────────────────────
interface AshbyBoard {
  jobs?: {
    title: string;
    jobUrl: string;
    location?: string;
    secondaryLocations?: { location: string }[];
    isRemote?: boolean;
    isListed?: boolean;
    workplaceType?: string;
    descriptionPlain?: string;
    descriptionHtml?: string;
    publishedAt?: string;
    compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  }[];
}

/** Normalises an Ashby posting-api board. */
export function parseAshby(data: AshbyBoard, c: Company): RawJobInput[] {
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const pay =
        j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary ?? "";
      return {
        title: j.title,
        company: c.name,
        url: j.jobUrl,
        location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)]
          .filter(Boolean)
          .join(" / "),
        workMode: detectWorkMode(j.isRemote ?? null, j.workplaceType),
        description: j.descriptionPlain ?? htmlToText(j.descriptionHtml),
        postedAt: isoDate(j.publishedAt),
        applyMethod: "form",
        source: src(c),
        ...parseSalary(pay),
      };
    });
}

async function fetchAshby(http: Fetch, c: Company) {
  return parseAshby(
    await getJson(http, `https://api.ashbyhq.com/posting-api/job-board/${c.slug}?includeCompensation=true`),
    c,
  );
}

// ─── Greenhouse ─────────────────────────────────────────────────────────────
interface GreenhouseBoard {
  jobs?: {
    title: string;
    absolute_url: string;
    location?: { name?: string };
    content?: string;
    updated_at?: string;
  }[];
}

/** Normalises a Greenhouse boards-api response (`?content=true`). */
export function parseGreenhouse(data: GreenhouseBoard, c: Company): RawJobInput[] {
  return (data.jobs ?? []).map((j) => {
    const description = htmlToText(j.content);
    const location = j.location?.name ?? "";
    return {
      title: j.title,
      company: c.name,
      url: j.absolute_url,
      location,
      workMode: detectWorkMode(location, j.title),
      description,
      postedAt: isoDate(j.updated_at),
      applyMethod: "form",
      source: src(c),
      ...parseSalary(description),
    };
  });
}

/**
 * EU-hosted boards (job-boards.eu.greenhouse.io) are not served by boards-api. Their page embeds the job list
 * as JSON in a script tag; this pulls `{"jobPosts":{"data":[...]}}` out of it.
 */
export function parseGreenhouseEuPage(html: string, c: Company): RawJobInput[] {
  const m = html.match(/"jobPosts":\{"data":(\[[\s\S]*?\]),"/);
  if (!m?.[1]) return [];
  const posts = JSON.parse(m[1]) as {
    title: string;
    absolute_url: string;
    location?: string;
    content?: string;
    published_at?: string;
  }[];
  return posts.map((p) => ({
    title: p.title,
    company: c.name,
    url: p.absolute_url,
    location: p.location ?? "",
    workMode: detectWorkMode(p.location, p.title),
    description: htmlToText(p.content),
    postedAt: isoDate(p.published_at),
    applyMethod: "form",
    source: src(c),
  }));
}

async function fetchGreenhouse(http: Fetch, c: Company) {
  try {
    return parseGreenhouse(
      await getJson(http, `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`),
      c,
    );
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
    return parseGreenhouseEuPage(await getText(http, `https://job-boards.eu.greenhouse.io/${c.slug}`), c);
  }
}

// ─── Lever ──────────────────────────────────────────────────────────────────
interface LeverPosting {
  text: string;
  hostedUrl: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  additionalPlain?: string;
  createdAt?: number;
  salaryRange?: { currency?: string; min?: number; max?: number; interval?: string };
}

/** Normalises a Lever v0 postings array. */
export function parseLever(data: LeverPosting[], c: Company): RawJobInput[] {
  return data.map((j) => {
    const location = (j.categories?.allLocations ?? [j.categories?.location]).filter(Boolean).join(" / ");
    const sr = j.salaryRange;
    return {
      title: j.text,
      company: c.name,
      url: j.hostedUrl,
      location,
      workMode: detectWorkMode(j.workplaceType, location),
      description: [j.descriptionPlain, j.additionalPlain].filter(Boolean).join("\n\n"),
      postedAt: isoDate(j.createdAt),
      applyMethod: "form",
      source: src(c),
      ...salaryFrom(sr?.min, sr?.max, sr?.currency, sr?.interval?.includes("year") ? "year" : sr?.interval),
    };
  });
}

async function fetchLever(http: Fetch, c: Company) {
  try {
    return parseLever(await getJson(http, `https://api.lever.co/v0/postings/${c.slug}?mode=json`), c);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
    return parseLever(await getJson(http, `https://api.eu.lever.co/v0/postings/${c.slug}?mode=json`), c);
  }
}

// ─── Workable ───────────────────────────────────────────────────────────────
interface WorkableAccount {
  jobs?: {
    title: string;
    url?: string;
    shortlink?: string;
    city?: string;
    country?: string;
    telecommuting?: boolean | string;
    description?: string;
    published_on?: string;
  }[];
}

/** Normalises a Workable widget account response (`?details=true`). */
export function parseWorkable(data: WorkableAccount, c: Company): RawJobInput[] {
  return (data.jobs ?? [])
    .filter((j) => j.url ?? j.shortlink)
    .map((j) => {
      const remote = String(j.telecommuting) === "true";
      const description = htmlToText(j.description);
      return {
        title: j.title,
        company: c.name,
        url: (j.url ?? j.shortlink) as string,
        location: [j.city, j.country].filter(Boolean).join(", "),
        workMode: remote ? "remote" : detectWorkMode(description.slice(0, 600)),
        description,
        postedAt: isoDate(j.published_on),
        applyMethod: "form",
        source: src(c),
        ...parseSalary(description),
      };
    });
}

async function fetchWorkable(http: Fetch, c: Company) {
  return parseWorkable(
    await getJson(http, `https://apply.workable.com/api/v1/widget/accounts/${c.slug}?details=true`),
    c,
  );
}

// ─── SmartRecruiters ────────────────────────────────────────────────────────
interface SmartRecruitersPage {
  content?: {
    id: string;
    name: string;
    releasedDate?: string;
    location?: { city?: string; country?: string; fullLocation?: string; remote?: boolean; hybrid?: boolean };
  }[];
}

/** Normalises one page of SmartRecruiters postings. Descriptions need a second call and are left empty. */
export function parseSmartRecruiters(data: SmartRecruitersPage, c: Company): RawJobInput[] {
  return (data.content ?? []).map((j) => {
    const l = j.location ?? {};
    return {
      title: j.name,
      company: c.name,
      url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`,
      location: l.fullLocation ?? [l.city, l.country].filter(Boolean).join(", "),
      workMode: l.remote ? "remote" : l.hybrid ? "hybrid" : "unknown",
      postedAt: isoDate(j.releasedDate),
      applyMethod: "form",
      source: src(c),
    };
  });
}

async function fetchSmartRecruiters(http: Fetch, c: Company) {
  const out: RawJobInput[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await getJson<SmartRecruitersPage>(
      http,
      `https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=100&offset=${offset}`,
    );
    out.push(...parseSmartRecruiters(page, c));
    if ((page.content ?? []).length < 100) break;
  }
  return out;
}

// ─── Personio ───────────────────────────────────────────────────────────────
const xmlTag = (block: string, tag: string) =>
  (block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .trim();

/** Normalises a Personio XML feed (`https://<slug>.jobs.personio.de/xml`). */
export function parsePersonio(xml: string, c: Company, host = `${c.slug}.jobs.personio.de`): RawJobInput[] {
  return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, block = ""]) => {
    const offices = [...block.matchAll(/<office>([\s\S]*?)<\/office>/g)].map((m) => (m[1] ?? "").trim());
    const description = htmlToText(
      [...block.matchAll(/<value>([\s\S]*?)<\/value>/g)].map((m) => m[1]).join("\n"),
    );
    const title = htmlToText(xmlTag(block, "name"));
    return {
      title,
      company: c.name,
      url: `https://${host}/job/${xmlTag(block, "id")}`,
      location: offices.join(" / "),
      workMode: detectWorkMode(offices.join(" "), title, xmlTag(block, "schedule")),
      description,
      postedAt: isoDate(xmlTag(block, "createdAt")),
      applyMethod: "form",
      source: src(c),
      ...parseSalary(description),
    };
  });
}

async function fetchPersonio(http: Fetch, c: Company) {
  for (const host of [`${c.slug}.jobs.personio.de`, `${c.slug}.jobs.personio.com`]) {
    const xml = await tryText(http, `https://${host}/xml`);
    if (xml?.includes("<workzag-jobs")) return parsePersonio(xml, c, host);
  }
  throw new Error(`no Personio feed for ${c.slug}`);
}

// ─── Recruitee ──────────────────────────────────────────────────────────────
interface RecruiteeOffers {
  offers?: {
    title: string;
    careers_url: string;
    location?: string;
    city?: string;
    country?: string;
    remote?: boolean | string;
    hybrid?: boolean | string;
    description?: string;
    requirements?: string;
    published_at?: string;
    salary?: { min?: number; max?: number; currency?: string; period?: string };
  }[];
}

/** Normalises a Recruitee offers response. */
export function parseRecruitee(data: RecruiteeOffers, c: Company): RawJobInput[] {
  return (data.offers ?? []).map((j) => {
    const remote = String(j.remote) === "true";
    const hybrid = String(j.hybrid) === "true";
    const s = j.salary ?? {};
    return {
      title: j.title,
      company: c.name,
      url: j.careers_url,
      location: j.location ?? [j.city, j.country].filter(Boolean).join(", "),
      workMode: remote ? "remote" : hybrid ? "hybrid" : "unknown",
      description: htmlToText([j.description, j.requirements].filter(Boolean).join("\n")),
      postedAt: isoDate(j.published_at),
      applyMethod: "form",
      source: src(c),
      ...salaryFrom(s.min, s.max, s.currency, s.period),
    };
  });
}

async function fetchRecruitee(http: Fetch, c: Company) {
  return parseRecruitee(await getJson(http, `https://${c.slug}.recruitee.com/api/offers`), c);
}

// ─── Workday ────────────────────────────────────────────────────────────────
interface WorkdayPage {
  jobPostings?: { title: string; externalPath?: string; locationsText?: string; postedOn?: string }[];
}

/** Splits a Workday slug "tenant/site/wdN" (or a full host as the third part) into its parts. */
export function workdayParts(slug: string): { tenant: string; site: string; host: string } {
  const [tenant = "", site = "", wd = "wd5"] = slug.split("/");
  if (!tenant || !site) throw new Error(`Workday slug must be "tenant/site/wdN", got "${slug}"`);
  return { tenant, site, host: wd.includes(".") ? wd : `${tenant}.${wd}.myworkdayjobs.com` };
}

/** Normalises one Workday cxs search page. Boards are huge, so we search with keywords instead of paging all. */
export function parseWorkday(data: WorkdayPage, c: Company): RawJobInput[] {
  const { host, site } = workdayParts(c.slug);
  return (data.jobPostings ?? [])
    .filter((j) => j.externalPath)
    .map((j) => ({
      title: j.title,
      company: c.name,
      url: `https://${host}/${site}${j.externalPath}`,
      location: j.locationsText ?? "",
      workMode: detectWorkMode(j.locationsText, j.title),
      applyMethod: "form",
      source: src(c),
    }));
}

async function fetchWorkday(http: Fetch, c: Company, keywords: string[]) {
  const { tenant, site, host } = workdayParts(c.slug);
  const seen = new Map<string, RawJobInput>();
  for (const searchText of keywords.slice(0, 12)) {
    const page = await postJson<WorkdayPage>(http, `https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText,
    });
    for (const job of parseWorkday(page, c)) seen.set(job.url, job);
  }
  return [...seen.values()];
}

// ─── Adapter ────────────────────────────────────────────────────────────────
type Fetcher = (http: Fetch, c: Company, keywords: string[]) => Promise<RawJobInput[]>;

const FETCHERS: Record<AtsKind, Fetcher> = {
  ashby: fetchAshby,
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
  personio: fetchPersonio,
  recruitee: fetchRecruitee,
  workday: fetchWorkday,
};

function isAtsKind(kind: string): kind is AtsKind {
  return (ATS_KINDS as readonly string[]).includes(kind);
}

/** Fetches every open role for one watched company. */
export async function fetchCompany(http: Fetch, c: Company, keywords: string[] = []): Promise<RawJobInput[]> {
  if (!isAtsKind(c.ats)) throw new Error(`unsupported ATS "${c.ats}" for ${c.name}`);
  return FETCHERS[c.ats](http, c, keywords);
}

/** Watches the companies listed in `config.sources.companies` through their public ATS boards. */
export const atsAdapter: SourceAdapter = {
  id: "ats",
  name: "Company job boards (ATS)",
  countries: ["*"],
  access: "official-api",
  async fetchJobs(ctx: SourceContext) {
    const results = await mapLimit(ctx.config.sources.companies, 6, async (c) => {
      try {
        return await fetchCompany(ctx.fetch, c, ctx.keywords);
      } catch (err) {
        ctx.log(`[ats] ${c.name}: ${(err as Error).message}`);
        return [];
      }
    });
    return results.flat();
  },
};

// ─── ATS detection (onboarding: "add a target company") ─────────────────────
const LEGAL =
  /\b(gmbh|ag|se|inc|ltd|llc|bv|b\.v\.|ug|co|kg|sas|sa|oy|ab|plc|corp(?:oration)?|company|group|holding|haftungsbeschränkt|& co\.?)\b\.?/gi;

/** Likely board slugs for a company name, e.g. "Acme Labs GmbH" → ["acmelabs", "acme-labs", "acme"]. */
export function candidateSlugs(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[()]/g, " ")
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9 .-]/g, " ")
    .split(/[\s.]+/)
    .filter(Boolean);
  const out = new Set([words.join(""), words.join("-")]);
  if (
    words.length > 1 &&
    /^(ai|io|app|hq|labs?|tech|technologies|software|energy|health)$/.test(words.at(-1) ?? "")
  ) {
    out.add(words.slice(0, -1).join(""));
  }
  return [...out].filter((s) => s.length >= 3);
}

/** Pulls `{ats, slug}` straight from a careers URL when it points at a known ATS host. */
export function atsFromUrl(url: string): { ats: AtsKind; slug: string } | null {
  const patterns: [AtsKind, RegExp][] = [
    ["ashby", /jobs\.ashbyhq\.com\/([^/?#]+)/],
    ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/],
    ["lever", /jobs(?:\.eu)?\.lever\.co\/([^/?#]+)/],
    ["workable", /apply\.workable\.com\/([^/?#]+)/],
    ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/],
    ["personio", /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/],
    ["recruitee", /([a-z0-9-]+)\.recruitee\.com/],
  ];
  for (const [ats, re] of patterns) {
    const slug = url.match(re)?.[1];
    if (slug) return { ats, slug: decodeURIComponent(slug) };
  }
  const wd = url.match(
    /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/,
  );
  if (wd) return { ats: "workday", slug: `${wd[1]}/${wd[3]}/${wd[2]}` };
  return null;
}

export interface DetectedAts {
  ats: AtsKind;
  slug: string;
  openJobs: number;
}

/**
 * Finds a company's public job board: from the URL when given one, otherwise by probing likely slugs on each ATS.
 * Requires the board to have open jobs and (for ambiguous ATSs) a slug that matches the company name.
 */
export async function detectAts(nameOrUrl: string, http: Fetch = fetch): Promise<DetectedAts | null> {
  if (/^https?:\/\//.test(nameOrUrl)) {
    const hit = atsFromUrl(nameOrUrl);
    if (!hit) return null;
    const jobs = await fetchCompany(http, { name: hit.slug, ...hit }).catch(() => []);
    return { ...hit, openJobs: jobs.length };
  }
  const exact = (slug: string) => companyKey(slug) === companyKey(nameOrUrl);
  for (const slug of candidateSlugs(nameOrUrl)) {
    const gh = await tryJson<GreenhouseBoard>(
      http,
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    );
    if (gh?.jobs?.length && exact(slug)) return { ats: "greenhouse", slug, openJobs: gh.jobs.length };
    const ashby = await tryJson<AshbyBoard>(http, `https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    if (ashby?.jobs?.length && exact(slug)) return { ats: "ashby", slug, openJobs: ashby.jobs.length };
    const lever = await tryJson<LeverPosting[]>(
      http,
      `https://api.lever.co/v0/postings/${slug}?mode=json&limit=5`,
    );
    if (Array.isArray(lever) && lever.length && exact(slug))
      return { ats: "lever", slug, openJobs: lever.length };
    for (const host of [`${slug}.jobs.personio.de`, `${slug}.jobs.personio.com`]) {
      const n = ((await tryText(http, `https://${host}/xml`)) ?? "").split("<position>").length - 1;
      if (n && exact(slug)) return { ats: "personio", slug, openJobs: n };
    }
    const rec = await tryJson<RecruiteeOffers>(http, `https://${slug}.recruitee.com/api/offers`);
    if (rec?.offers?.length && exact(slug)) return { ats: "recruitee", slug, openJobs: rec.offers.length };
    const wk = await tryJson<WorkableAccount & { name?: string }>(
      http,
      `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    );
    if (wk?.jobs?.length && (!wk.name || companyKey(wk.name).startsWith(companyKey(nameOrUrl)))) {
      return { ats: "workable", slug, openJobs: wk.jobs.length };
    }
  }
  return null;
}
