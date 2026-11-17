// The scout: fetch from every enabled source, store new jobs, and run the deterministic first-pass screening.
// Kept jobs stay "new" with a fit score; the agent triages them by reading the full description.
import type { App } from "../core/app.ts";
import { RawJob, type RawJobInput } from "../core/schema.ts";
import { screen } from "../core/screening.ts";
import type { JobRow } from "../db/repository.ts";
import { mapLimit } from "./http.ts";
import { getAdapters } from "./registry.ts";
import type { SourceAdapter, SourceContext } from "./types.ts";

export interface ScoutOptions {
  /** Run only these adapter ids. */
  only?: string[];
  log?: (message: string) => void;
  /** Override the adapters (tests, plugins). Defaults to the enabled ones from the config. */
  adapters?: SourceAdapter[];
  fetch?: typeof fetch;
}

export interface ScoutResult {
  fetched: number;
  new: number;
  kept: number;
  dropped: number;
  parked: number;
  bySource: Record<string, number>;
  errors: string[];
}

/** Search terms from the config: target roles first, then extra keywords, de-duplicated case-insensitively. */
export function scoutKeywords(app: App): string[] {
  const seen = new Set<string>();
  return [...app.config.targets.roles, ...app.config.targets.keywords].filter((k) => {
    const key = k.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toRawJob(row: JobRow): RawJob {
  return RawJob.parse({
    title: row.title,
    company: row.company,
    url: row.url,
    location: row.location,
    workMode: row.work_mode,
    description: row.description,
    salaryMin: row.salary_min ?? undefined,
    salaryMax: row.salary_max ?? undefined,
    currency: row.currency,
    applyMethod: row.apply_method,
    source: row.source,
  });
}

/** Fetches, stores and screens. Safe to run repeatedly: known jobs are skipped by fingerprint. */
export async function runScout(app: App, opts: ScoutOptions = {}): Promise<ScoutResult> {
  const log = opts.log ?? (() => {});
  const result: ScoutResult = {
    fetched: 0,
    new: 0,
    kept: 0,
    dropped: 0,
    parked: 0,
    bySource: {},
    errors: [],
  };
  const adapters = (opts.adapters ?? getAdapters(app.config)).filter(
    (a) => !opts.only || opts.only.includes(a.id),
  );
  // Adapters only log problems (a board that failed, a search that errored), so their log lines count as errors.
  const ctx: SourceContext = {
    config: app.config,
    keywords: scoutKeywords(app),
    fetch: opts.fetch ?? fetch,
    log: (m) => {
      result.errors.push(m);
      log(m);
    },
  };

  const batches = await mapLimit(adapters, 3, async (adapter) => {
    try {
      const jobs = await adapter.fetchJobs(ctx);
      log(`[${adapter.id}] ${jobs.length} jobs`);
      return { adapter, jobs };
    } catch (err) {
      ctx.log(`[${adapter.id}] failed: ${err instanceof Error ? err.message : String(err)}`);
      return { adapter, jobs: [] as RawJobInput[] };
    }
  });

  const valid: RawJobInput[] = [];
  for (const { adapter, jobs } of batches) {
    result.fetched += jobs.length;
    result.bySource[adapter.id] = jobs.length;
    for (const job of jobs) {
      const parsed = RawJob.safeParse(job);
      if (parsed.success) valid.push(job);
      else
        result.errors.push(
          `[${adapter.id}] invalid job "${job.title ?? "?"}": ${parsed.error.issues[0]?.message}`,
        );
    }
  }

  const newIds = app.repo.insertJobs(valid);
  result.new = newIds.length;
  for (const id of newIds) screenJob(app, id, result);
  log(
    `[scout] fetched ${result.fetched}, new ${result.new}, kept ${result.kept}, dropped ${result.dropped}, parked ${result.parked}`,
  );
  return result;
}

function screenJob(app: App, id: number, result: ScoutResult): void {
  const row = app.repo.getJob(id);
  if (!row) return;
  const verdict = screen(toRawJob(row), app.config);
  if (verdict.decision === "keep") {
    app.repo.setFit(id, verdict.score, verdict.reasons);
    result.kept++;
  } else {
    app.repo.setStatus(id, verdict.decision === "drop" ? "dropped" : "parked", "scout", verdict.reason);
    result[verdict.decision === "drop" ? "dropped" : "parked"]++;
  }
}
