// `job-pipeline demo [sam|erika]`: a throwaway workspace with a fictional candidate and fictional jobs,
// so anyone can look at the dashboard in seconds. Nothing here touches the network or a real mailbox.
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { type App, createApp } from "../core/app.ts";
import { JOB_STATUSES, type JobStatus, WorkMode } from "../core/schema.ts";
import { ensureWorkspace, resolveWorkspace } from "../core/workspace.ts";

const EXAMPLES = join(import.meta.dir, "..", "..", "examples");
export const DEMO_PERSONAS = ["sam", "erika"] as const;

const Place = z.object({ location: z.string(), workMode: WorkMode.default("unknown") });
const FeaturedJob = Place.extend({
  title: z.string(),
  company: z.string(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  currency: z.string().optional(),
  path: z.array(z.enum(JOB_STATUSES)),
  fit: z.number(),
  reasons: z.array(z.string()),
  hoursAgo: z.number().default(1),
  note: z.string().optional(),
  cover: z.string().optional(),
}).strict();
type FeaturedJob = z.infer<typeof FeaturedJob>;
const DemoFile = z.object({
  featured: z.array(FeaturedJob),
  bulk: z.object({
    companies: z.array(z.string()).min(1),
    titles: z.array(z.string()).min(1),
    places: z.array(Place).min(1),
    counts: z.object({ new: z.number(), applied: z.number(), rejected: z.number() }),
  }),
});

const PATHS = {
  new: [],
  applied: ["drafted", "approved", "applied"],
  rejected: ["drafted", "approved", "applied", "rejected"],
} as const satisfies Record<string, JobStatus[]>;

/** Who moves a job into each status in a real run. */
const ACTOR: Partial<Record<JobStatus, string>> = {
  approved: "user",
  drafted: "agent",
  applied: "agent",
  dropped: "scout",
  parked: "scout",
};

/** Background jobs: every company × title combination is unique, so none collapse as duplicates. */
function bulkJobs(bulk: z.infer<typeof DemoFile>["bulk"]): FeaturedJob[] {
  const jobs: FeaturedJob[] = [];
  let k = 0;
  for (const [status, count] of Object.entries(bulk.counts) as [keyof typeof PATHS, number][]) {
    for (let i = 0; i < count; i++, k++) {
      const place = bulk.places[k % bulk.places.length] as z.infer<typeof Place>;
      jobs.push({
        ...place,
        title: bulk.titles[Math.floor(k / bulk.companies.length) % bulk.titles.length] as string,
        company: bulk.companies[k % bulk.companies.length] as string,
        path: [...PATHS[status]],
        fit: 60 + ((k * 7) % 30),
        reasons: [],
        // Spread over the last two weeks so the activity chart has a shape.
        hoursAgo: status === "new" ? 2 + k : 24 * ((k * 5) % 13) + 6,
      });
    }
  }
  return jobs;
}

/** Creates the demo workspace for a persona and returns an app on it. */
export function createDemo(persona = "sam"): App {
  const dir = join(EXAMPLES, persona);
  if (!existsSync(join(dir, "demo-jobs.yaml")))
    throw new Error(`Unknown demo "${persona}". Try: ${DEMO_PERSONAS.join(", ")}`);
  const data = DemoFile.parse(parse(readFileSync(join(dir, "demo-jobs.yaml"), "utf8")));

  const ws = resolveWorkspace(mkdtempSync(join(tmpdir(), "job-pipeline-demo-")));
  ensureWorkspace(ws);
  copyFileSync(join(dir, "job-pipeline.config.yaml"), ws.configPath);
  copyFileSync(join(dir, "facts.yaml"), ws.factsPath);
  const app = createApp(ws);

  [...data.featured, ...bulkJobs(data.bulk)].forEach((j, i) => {
    const { path, fit, reasons, cover, note, hoursAgo, ...raw } = j;
    const [id] = app.repo.insertJobs([
      {
        ...raw,
        url: `https://example.com/jobs/${i + 1}`,
        source: "demo",
        description: `${j.title} at ${j.company}. Fictional posting for the demo.`,
      },
    ]);
    if (id === undefined) return;
    if (fit) app.repo.setFit(id, fit, reasons);
    for (const to of path) {
      if (to === "approved")
        app.repo.grantApproval({
          jobId: id,
          action: "submit_application",
          scope: "job",
          wording: "Go, send it",
          grantedBy: "user",
        });
      const why = to === "applied" ? "form submitted, confirmation seen" : (note ?? "");
      app.repo.setStatus(id, to, ACTOR[to] ?? "mailbot", why);
    }
    if (cover)
      app.repo.saveDocument({ jobId: id, kind: "cover_note", language: "en", body: cover, factIds: [] });
    app.repo.backdate(id, hoursAgo);
  });
  return app;
}
