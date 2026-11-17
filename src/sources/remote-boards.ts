// Remote job boards with official APIs or public feeds. Each board asks to link back to its posting; we keep
// the board's URL as the job URL. Location restrictions are kept in `location` so screening can check them.
import type { RawJobInput } from "../core/schema.ts";
import { type Fetch, getJson, getText } from "./http.ts";
import { decodeEntities, htmlToText, isoDate, salaryFrom } from "./normalize.ts";
import type { SourceAdapter, SourceContext } from "./types.ts";

// ─── Remote OK ──────────────────────────────────────────────────────────────
interface RemoteOkJob {
  position?: string;
  company?: string;
  url?: string;
  location?: string;
  description?: string;
  date?: string;
  salary_min?: number;
  salary_max?: number;
}

/** Normalises the Remote OK feed (first element is a legal notice and is skipped). */
export function parseRemoteOk(data: RemoteOkJob[]): RawJobInput[] {
  return data
    .filter((j) => j.position && j.company && j.url)
    .map((j) => ({
      title: j.position as string,
      company: j.company as string,
      url: j.url as string,
      location: `Remote (${j.location || "worldwide"})`,
      workMode: "remote",
      description: htmlToText(j.description),
      postedAt: isoDate(j.date),
      applyMethod: "form",
      source: "remoteok",
      ...salaryFrom(j.salary_min, j.salary_max, "USD"),
    }));
}

// ─── Himalayas ──────────────────────────────────────────────────────────────
interface HimalayasPage {
  jobs?: {
    title: string;
    companyName: string;
    applicationLink: string;
    locationRestrictions?: string[];
    description?: string;
    excerpt?: string;
    pubDate?: number | string;
    minSalary?: number;
    maxSalary?: number;
    currency?: string;
    salaryPeriod?: string;
  }[];
}

/** Normalises one Himalayas search page. */
export function parseHimalayas(data: HimalayasPage): RawJobInput[] {
  return (data.jobs ?? []).map((j) => ({
    title: j.title,
    company: j.companyName,
    url: j.applicationLink,
    location: `Remote (${j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Worldwide"})`,
    workMode: "remote",
    description: htmlToText(j.description ?? j.excerpt),
    postedAt: isoDate(typeof j.pubDate === "number" ? j.pubDate * 1000 : j.pubDate),
    applyMethod: "form",
    source: "himalayas",
    ...salaryFrom(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod ?? "annual"),
  }));
}

async function fetchHimalayas(http: Fetch, keyword: string, country: string): Promise<RawJobInput[]> {
  const out: RawJobInput[] = [];
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({ q: keyword, country, worldwide: "true", page: String(page) });
    const data = await getJson<HimalayasPage>(http, `https://himalayas.app/jobs/api/search?${params}`);
    out.push(...parseHimalayas(data));
    if ((data.jobs ?? []).length < 20) break;
  }
  return out;
}

// ─── We Work Remotely ───────────────────────────────────────────────────────
const WWR_FEEDS = [
  "remote-product-jobs",
  "remote-customer-support-jobs",
  "remote-sales-and-marketing-jobs",
  "remote-management-and-finance-jobs",
  "all-other-remote-jobs",
];

const rssTag = (xml: string, tag: string) =>
  xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]?.trim() ?? "";

/** Normalises a We Work Remotely category RSS feed. Titles come as "Company: Role". */
export function parseWeWorkRemotely(xml: string): RawJobInput[] {
  return xml
    .split("<item>")
    .slice(1)
    .map((item): RawJobInput | null => {
      const full = decodeEntities(rssTag(item, "title"));
      const i = full.indexOf(":");
      const url = rssTag(item, "link") || rssTag(item, "guid");
      if (i <= 0 || !url) return null;
      return {
        company: full.slice(0, i).trim(),
        title: full.slice(i + 1).trim(),
        url,
        location: `Remote (${rssTag(item, "region") || "unspecified"})`,
        workMode: "remote",
        description: htmlToText(rssTag(item, "description")),
        postedAt: isoDate(rssTag(item, "pubDate")),
        applyMethod: "form",
        source: "weworkremotely",
      };
    })
    .filter((j): j is RawJobInput => j !== null);
}

// ─── Arbeitnow ──────────────────────────────────────────────────────────────
interface ArbeitnowPage {
  data?: {
    title: string;
    company_name: string;
    url: string;
    location?: string;
    remote?: boolean;
    description?: string;
    created_at?: number;
  }[];
  links?: { next?: string | null };
}

/** Normalises one Arbeitnow page (German/EU jobs, many English-speaking startups). */
export function parseArbeitnow(data: ArbeitnowPage): RawJobInput[] {
  return (data.data ?? []).map((j) => ({
    title: j.title,
    company: j.company_name,
    url: j.url,
    location: j.remote ? `Remote (${j.location || "Germany"})` : (j.location ?? ""),
    workMode: j.remote ? "remote" : "unknown",
    description: htmlToText(j.description),
    postedAt: isoDate(j.created_at ? j.created_at * 1000 : undefined),
    applyMethod: "form",
    source: "arbeitnow",
  }));
}

async function fetchArbeitnow(http: Fetch): Promise<RawJobInput[]> {
  const out: RawJobInput[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await getJson<ArbeitnowPage>(
      http,
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
    );
    out.push(...parseArbeitnow(data));
    if (!data.links?.next) break;
  }
  return out;
}

// ─── Jobicy ─────────────────────────────────────────────────────────────────
interface JobicyResponse {
  jobs?: {
    jobTitle: string;
    companyName: string;
    url: string;
    jobGeo?: string;
    jobDescription?: string;
    jobExcerpt?: string;
    pubDate?: string;
    annualSalaryMin?: number;
    annualSalaryMax?: number;
    salaryCurrency?: string;
  }[];
}

/** Normalises the Jobicy remote-jobs API. */
export function parseJobicy(data: JobicyResponse): RawJobInput[] {
  return (data.jobs ?? []).map((j) => ({
    title: decodeEntities(j.jobTitle),
    company: decodeEntities(j.companyName),
    url: j.url,
    location: `Remote (${j.jobGeo || "unspecified"})`,
    workMode: "remote",
    description: htmlToText(j.jobDescription ?? j.jobExcerpt),
    postedAt: isoDate(j.pubDate),
    applyMethod: "form",
    source: "jobicy",
    ...salaryFrom(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency),
  }));
}

// ─── Adapter ────────────────────────────────────────────────────────────────
/** Runs one board, logging and swallowing its failure so the others still deliver. */
async function board(
  ctx: SourceContext,
  name: string,
  run: () => Promise<RawJobInput[]>,
): Promise<RawJobInput[]> {
  try {
    return await run();
  } catch (err) {
    ctx.log(`[remote-boards] ${name}: ${(err as Error).message}`);
    return [];
  }
}

/** Remote OK, Himalayas, We Work Remotely, Arbeitnow and Jobicy. Screening drops roles not open to the user's country. */
export const remoteBoardsAdapter: SourceAdapter = {
  id: "remote-boards",
  name: "Remote job boards",
  countries: ["*"],
  access: "public-feed",
  async fetchJobs(ctx) {
    const http = ctx.fetch;
    const country = ctx.config.candidate.country;
    const batches = await Promise.all([
      board(ctx, "remoteok", async () => parseRemoteOk(await getJson(http, "https://remoteok.com/api"))),
      board(ctx, "himalayas", async () =>
        (await Promise.all(ctx.keywords.slice(0, 10).map((k) => fetchHimalayas(http, k, country)))).flat(),
      ),
      board(ctx, "weworkremotely", async () =>
        (
          await Promise.all(
            WWR_FEEDS.map(async (f) =>
              parseWeWorkRemotely(await getText(http, `https://weworkremotely.com/categories/${f}.rss`)),
            ),
          )
        ).flat(),
      ),
      board(ctx, "arbeitnow", () => fetchArbeitnow(http)),
      board(ctx, "jobicy", async () =>
        parseJobicy(await getJson(http, "https://jobicy.com/api/v2/remote-jobs?count=100")),
      ),
    ]);
    return batches.flat();
  },
};
