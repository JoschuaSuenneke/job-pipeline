// Local dashboard: a JSON API plus a no-build single-page UI. Binds to 127.0.0.1 only.
// The approve endpoint is the human approval channel the policy engine relies on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../core/app.ts";
import { Config, JobStatus } from "../core/schema.ts";
import { canTransition, nextStatuses } from "../core/status.ts";
import { saveConfig } from "../core/workspace.ts";

export const DEFAULT_PORT = 4747;
const UI_DIR = join(import.meta.dir, "ui");
const STATIC: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
};
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};
const REPLIED = ["conversation", "interview", "offer", "accepted", "rejected"] as const;
const EVER_APPLIED = ["applied", ...REPLIED] as const;

const StatusBody = z.object({ to: JobStatus, note: z.string().max(2000).default("") });
const ApproveBody = z.object({
  wording: z.string().trim().min(3, "Write the go in your own words.").max(500),
});

/** Blocks DNS rebinding (wrong Host) and cross-site writes (foreign Origin, non-JSON bodies). */
function localOnly(port: number): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    const host = c.req.header("host");
    if (host && !hosts.has(host)) return c.json({ error: "unknown host" }, 403);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      if (origin ? !origins.has(origin) : site !== undefined && site !== "same-origin") {
        return c.json({ error: "cross-origin request rejected" }, 403);
      }
      if (!c.req.header("content-type")?.includes("application/json")) {
        return c.json({ error: "expected application/json" }, 415);
      }
    }
    await next();
  };
}

function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

async function readJson(req: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** Builds the Hono app. Exported separately so tests can call it without a socket. */
export function createDashboard(app: App, port = DEFAULT_PORT): Hono {
  const http = new Hono();
  http.use("*", localOnly(port));

  http.get("/api/summary", (c) => {
    const counts = app.repo.countByStatus();
    const sum = (keys: readonly string[]) => keys.reduce((n, k) => n + (counts[k] ?? 0), 0);
    const everApplied = sum(EVER_APPLIED);
    const perDay = app.repo.appliedPerDay(14);
    return c.json({
      counts,
      appliedToday: app.repo.appliedToday(),
      responseRate: everApplied ? sum(REPLIED) / everApplied : null,
      appliedPerDay: lastDays(14).map((day) => ({ day, n: perDay.find((r) => r.day === day)?.n ?? 0 })),
      candidate: app.config.candidate.name,
    });
  });

  http.get("/api/jobs", (c) => {
    const status = c.req.query("status");
    const q = c.req.query("q")?.trim().toLowerCase();
    const parsed = status ? JobStatus.safeParse(status) : null;
    if (parsed && !parsed.success) return c.json({ error: `unknown status "${status}"` }, 400);
    const jobs = app.repo
      .listJobs({ status: parsed?.success ? [parsed.data] : undefined, limit: 1000 })
      .filter((j) => !q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q))
      .map(({ description: _d, ...rest }) => rest);
    return c.json(jobs);
  });

  http.get("/api/jobs/:id", (c) => {
    const id = Number(c.req.param("id"));
    const job = app.repo.getJob(id);
    if (!job) return c.json({ error: "not found" }, 404);
    return c.json({
      job,
      documents: {
        cv: app.repo.latestDocument(id, "cv"),
        coverNote: app.repo.latestDocument(id, "cover_note"),
        answers: app.repo.latestDocument(id, "answers"),
      },
      events: app.repo.events(id),
      next: nextStatuses(job.status).filter((s) => s !== "approved"),
    });
  });

  http.post("/api/jobs/:id/status", async (c) => {
    const id = Number(c.req.param("id"));
    const body = StatusBody.safeParse(await readJson(c.req));
    if (!body.success) return c.json({ error: "invalid body", issues: issues(body.error) }, 400);
    const job = app.repo.getJob(id);
    if (!job) return c.json({ error: "not found" }, 404);
    if (body.data.to === "approved") return c.json({ error: "use /approve to approve a job" }, 400);
    if (!canTransition(job.status, body.data.to)) {
      return c.json({ error: `${job.status} → ${body.data.to} is not a valid transition` }, 400);
    }
    return c.json(app.repo.setStatus(id, body.data.to, "user", body.data.note));
  });

  http.post("/api/jobs/:id/approve", async (c) => {
    const id = Number(c.req.param("id"));
    const body = ApproveBody.safeParse(await readJson(c.req));
    if (!body.success) return c.json({ error: "invalid body", issues: issues(body.error) }, 400);
    const job = app.repo.getJob(id);
    if (!job) return c.json({ error: "not found" }, 404);
    if (!canTransition(job.status, "approved")) {
      return c.json({ error: `a "${job.status}" job cannot be approved` }, 400);
    }
    const approvalId = app.repo.grantApproval({
      jobId: id,
      action: "submit_application",
      scope: "job",
      wording: body.data.wording,
      grantedBy: "user",
    });
    const updated =
      job.status === "approved" ? job : app.repo.setStatus(id, "approved", "user", body.data.wording);
    return c.json({ approvalId, job: updated });
  });

  http.get("/api/events", (c) => c.json(app.repo.events(undefined, Number(c.req.query("limit") ?? 200))));

  http.get("/api/mail", (c) => c.json(app.repo.listMail(300)));

  http.get("/api/config", (c) => c.json(app.config));

  http.put("/api/config", async (c) => {
    const parsed = Config.safeParse(await readJson(c.req));
    if (!parsed.success) return c.json({ error: "invalid config", issues: issues(parsed.error) }, 400);
    app.config = saveConfig(app.ws, parsed.data);
    return c.json(app.config);
  });

  http.get("*", (c) => {
    const file = STATIC[c.req.path];
    if (!file) return c.json({ error: "not found" }, 404);
    const ext = file.split(".").pop() ?? "html";
    return c.body(readFileSync(join(UI_DIR, file), "utf8"), 200, {
      "content-type": MIME[ext] ?? "text/plain",
      "cache-control": "no-store",
      // Scripts only from our own files; inline style attributes are allowed for computed sizes and colours (fit bars, avatars).
      "content-security-policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    });
  });

  return http;
}

export function startDashboard(app: App, opts: { port?: number } = {}): { url: string; stop(): void } {
  const port = opts.port ?? DEFAULT_PORT;
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: createDashboard(app, port).fetch });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

function lastDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
