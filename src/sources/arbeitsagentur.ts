// Bundesagentur für Arbeit, Jobbörse: the official public job search API for Germany.
// It carries most German postings, including employers that use no ATS.
import type { Config, RawJobInput } from "../core/schema.ts";
import { type Fetch, getJson } from "./http.ts";
import type { SourceAdapter, SourceContext } from "./types.ts";

const API = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
/** Public client key the official web app uses; documented by the community (bundesAPI/jobsuche-api). */
const API_KEY = "jobboerse-jobsuche";
const HOME_RADIUS_KM = 50;
const PLACE_RADIUS_KM = 20;
const MAX_PLACES = 6;
const REMOTE_TITLE = /remote|homeoffice|home[\s-]office|100\s*%|deutschlandweit|ortsunabh|mobiles arbeiten/i;

/**
 * One result row of the jobsuche API (only the fields we use). The API has renamed fields over time
 * (v6: referenznummer, firma, alleBerufe, datumErsteVeroeffentlichung), so both generations are read.
 */
export interface BaJob {
  refnr?: string;
  referenznummer?: string;
  titel?: string;
  stellenangebotsTitel?: string;
  hauptberuf?: string;
  beruf?: string;
  alleBerufe?: string[];
  arbeitgeber?: string;
  firma?: string;
  arbeitsort?: { ort?: string; plz?: string; land?: string };
  stellenlokationen?: { adresse?: { ort?: string; land?: string } }[];
  eintrittsdatum?: string;
  aktuelleVeroeffentlichungsdatum?: string;
  datumErsteVeroeffentlichung?: string;
  homeofficemoeglich?: boolean;
}

interface BaResponse {
  stellenangebote?: BaJob[];
  ergebnisliste?: BaJob[];
}

/** A search the adapter runs: around a place (with radius) or nationwide. */
export interface BaQuery {
  was: string;
  wo?: string;
  umkreis?: number;
}

/** Normalises one jobsuche result. `origin` is the place the search ran around, appended for commute matching. */
export function parseBaJob(j: BaJob, origin?: string): RawJobInput | null {
  const title = j.titel ?? j.stellenangebotsTitel ?? j.hauptberuf ?? j.beruf ?? "";
  const ref = j.refnr ?? j.referenznummer;
  const company = j.arbeitgeber ?? j.firma;
  if (!title || !ref || !company) return null;
  const ort = j.arbeitsort?.ort ?? j.stellenlokationen?.[0]?.adresse?.ort ?? "";
  const land = j.arbeitsort?.land ?? j.stellenlokationen?.[0]?.adresse?.land ?? "Deutschland";
  const remote = REMOTE_TITLE.test(title);
  // "Münster, Westfalen" searched around "Münster" is Münster itself, not "near" it.
  const isOrigin = origin ? ort.toLowerCase().startsWith(origin.toLowerCase()) : true;
  const place = ort && !isOrigin ? `${ort} (near ${origin})` : ort;
  return {
    title,
    company,
    url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(ref)}`,
    location: [place, /deutschland/i.test(land) ? "Germany" : land].filter(Boolean).join(", "),
    workMode: remote ? "remote" : j.homeofficemoeglich ? "hybrid" : "unknown",
    description: [title, j.beruf, ...(j.alleBerufe ?? [])].filter(Boolean).join("\n"),
    postedAt: j.aktuelleVeroeffentlichungsdatum ?? j.datumErsteVeroeffentlichung,
    applyMethod: "unknown",
    source: "arbeitsagentur",
  };
}

/** Runs one search (newest 100 results of the last 30 days). */
export async function searchBa(http: Fetch, q: BaQuery): Promise<BaJob[]> {
  const params = new URLSearchParams({
    angebotsart: "1",
    page: "1",
    size: "100",
    veroeffentlichtseit: "30",
    was: q.was,
  });
  if (q.wo) params.set("wo", q.wo);
  if (q.umkreis) params.set("umkreis", String(q.umkreis));
  const data = await getJson<BaResponse>(http, `${API}?${params}`, { "X-API-Key": API_KEY });
  return data.stellenangebote ?? data.ergebnisliste ?? [];
}

/** Places to search around: home plus the named places of each commute tier that allows office days. */
export function searchPlaces(config: Config): { wo: string; umkreis: number }[] {
  const places = [{ wo: config.candidate.home, umkreis: HOME_RADIUS_KM }];
  for (const tier of config.location.tiers) {
    if (tier.maxOfficeDays === 0) continue;
    for (const wo of tier.places) {
      if (places.length > MAX_PLACES) break;
      if (!places.some((p) => p.wo.toLowerCase() === wo.toLowerCase()))
        places.push({ wo, umkreis: PLACE_RADIUS_KM });
    }
  }
  return places;
}

async function searchKeyword(ctx: SourceContext, keyword: string): Promise<RawJobInput[]> {
  const out: RawJobInput[] = [];
  for (const place of searchPlaces(ctx.config)) {
    const rows = await searchBa(ctx.fetch, { was: keyword, ...place }).catch((err: Error) => {
      ctx.log(`[arbeitsagentur] ${keyword} @ ${place.wo}: ${err.message}`);
      return [];
    });
    for (const row of rows) {
      const job = parseBaJob(row, place.wo);
      if (job) out.push(job);
    }
  }
  const national = await searchBa(ctx.fetch, { was: keyword }).catch(() => []);
  for (const row of national) {
    const job = parseBaJob(row);
    if (job?.workMode === "remote") out.push(job);
  }
  return out;
}

/** German Federal Employment Agency job search: around home, around commute-tier places, and remote nationwide. */
export const arbeitsagenturAdapter: SourceAdapter = {
  id: "arbeitsagentur",
  name: "Bundesagentur für Arbeit (Jobbörse)",
  countries: ["DE"],
  access: "official-api",
  async fetchJobs(ctx) {
    const seen = new Map<string, RawJobInput>();
    for (const keyword of ctx.keywords) {
      for (const job of await searchKeyword(ctx, keyword)) if (!seen.has(job.url)) seen.set(job.url, job);
    }
    return [...seen.values()];
  },
};
