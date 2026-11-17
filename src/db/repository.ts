// Data access for jobs, events, documents and approvals. The only module that writes SQL.
import type { Database } from "bun:sqlite";
import { companyKey, titleKey } from "../core/names.ts";
import { type JobStatus, RawJob, type RawJobInput } from "../core/schema.ts";
import { canTransition } from "../core/status.ts";

export interface JobRow {
  id: number;
  fingerprint: string;
  title: string;
  company: string;
  url: string;
  location: string;
  work_mode: string;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  posted_at: string | null;
  apply_method: string;
  apply_email: string | null;
  source: string;
  status: JobStatus;
  fit_score: number | null;
  fit_reasons: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  job_id: number | null;
  at: string;
  actor: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string;
}

/** Same role at the same company is the same job, whatever board it came from. */
export function fingerprint(company: string, title: string): string {
  return `${companyKey(company)}::${titleKey(title)}`;
}

export class Repository {
  constructor(private readonly db: Database) {}

  /** Inserts new jobs, skips known ones. Returns the ids of jobs that were actually new. */
  insertJobs(jobs: RawJobInput[]): number[] {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO jobs (fingerprint, title, company, url, location, work_mode, description, salary_min,
         salary_max, currency, posted_at, apply_method, apply_email, source)
       VALUES ($fp, $title, $company, $url, $location, $workMode, $description, $salaryMin, $salaryMax, $currency,
         $postedAt, $applyMethod, $applyEmail, $source) RETURNING id`,
    );
    const ids: number[] = [];
    this.db.transaction(() => {
      for (const input of jobs) {
        const j = RawJob.parse(input);
        const row = insert.get({
          fp: fingerprint(j.company, j.title),
          title: j.title,
          company: j.company,
          url: j.url,
          location: j.location,
          workMode: j.workMode,
          description: j.description,
          salaryMin: j.salaryMin ?? null,
          salaryMax: j.salaryMax ?? null,
          currency: j.currency ?? "",
          postedAt: j.postedAt ?? null,
          applyMethod: j.applyMethod,
          applyEmail: j.applyEmail ?? null,
          source: j.source,
        }) as { id: number } | null;
        if (row) {
          ids.push(row.id);
          this.logEvent({ jobId: row.id, actor: "scout", kind: "sourced", note: j.source });
        }
      }
    })();
    return ids;
  }

  getJob(id: number): JobRow | null {
    return this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  }

  listJobs(filter: { status?: JobStatus[]; company?: string; limit?: number } = {}): JobRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => "?").join(",")})`);
      params.push(...filter.status);
    }
    if (filter.company) {
      where.push("lower(company) = lower(?)");
      params.push(filter.company);
    }
    const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY COALESCE(fit_score, -1) DESC, id DESC LIMIT ${filter.limit ?? 500}`;
    return this.db.query(sql).all(...params) as JobRow[];
  }

  countByStatus(): Record<string, number> {
    const rows = this.db.query("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all() as {
      status: string;
      n: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  setStatus(id: number, to: JobStatus, actor: string, note = ""): JobRow {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (!canTransition(job.status, to))
      throw new Error(`Job ${id}: ${job.status} → ${to} is not a valid transition`);
    this.db.transaction(() => {
      this.db.query("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, id);
      this.logEvent({ jobId: id, actor, kind: "status", from: job.status, to, note });
    })();
    return { ...job, status: to };
  }

  setFit(id: number, score: number, reasons: string[]): void {
    this.db
      .query("UPDATE jobs SET fit_score = ?, fit_reasons = ? WHERE id = ?")
      .run(score, JSON.stringify(reasons), id);
  }

  logEvent(e: {
    jobId?: number | null;
    actor: string;
    kind: string;
    from?: string;
    to?: string;
    note?: string;
  }): void {
    this.db
      .query(
        "INSERT INTO events (job_id, actor, kind, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(e.jobId ?? null, e.actor, e.kind, e.from ?? null, e.to ?? null, e.note ?? "");
  }

  events(jobId?: number, limit = 200): EventRow[] {
    return (
      jobId
        ? this.db.query("SELECT * FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?").all(jobId, limit)
        : this.db.query("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit)
    ) as EventRow[];
  }

  saveDocument(d: {
    jobId: number;
    kind: "cv" | "cover_note" | "answers";
    language: string;
    body: string;
    factIds: string[];
    path?: string;
  }): number {
    const row = this.db
      .query(
        "INSERT INTO documents (job_id, kind, language, body, fact_ids, path) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get(d.jobId, d.kind, d.language, d.body, JSON.stringify(d.factIds), d.path ?? null) as { id: number };
    this.logEvent({ jobId: d.jobId, actor: "agent", kind: "document", note: `${d.kind} (${d.language})` });
    return row.id;
  }

  latestDocument(
    jobId: number,
    kind: string,
  ): { body: string; fact_ids: string; path: string | null; language: string } | null {
    return this.db
      .query(
        "SELECT body, fact_ids, path, language FROM documents WHERE job_id = ? AND kind = ? ORDER BY id DESC LIMIT 1",
      )
      .get(jobId, kind) as { body: string; fact_ids: string; path: string | null; language: string } | null;
  }

  grantApproval(a: {
    jobId: number | null;
    action: string;
    scope: string;
    wording: string;
    grantedBy: string;
  }): number {
    const row = this.db
      .query(
        "INSERT INTO approvals (job_id, action, scope, wording, granted_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
      )
      .get(a.jobId, a.action, a.scope, a.wording, a.grantedBy) as { id: number };
    this.logEvent({
      jobId: a.jobId,
      actor: a.grantedBy,
      kind: "approval",
      note: `${a.action}: "${a.wording}"`,
    });
    return row.id;
  }

  /** Finds an unused approval for this job and action, marks it used and returns it. */
  consumeApproval(jobId: number, action: string): { id: number; wording: string } | null {
    const row = this.db
      .query(
        "SELECT id, wording FROM approvals WHERE job_id = ? AND action = ? AND used_at IS NULL ORDER BY id LIMIT 1",
      )
      .get(jobId, action) as { id: number; wording: string } | null;
    if (row) this.db.query("UPDATE approvals SET used_at = datetime('now') WHERE id = ?").run(row.id);
    return row;
  }

  appliedToday(): number {
    const row = this.db
      .query(
        "SELECT COUNT(*) AS n FROM events WHERE kind = 'status' AND to_status = 'applied' AND date(at) = date('now')",
      )
      .get() as { n: number };
    return row.n;
  }

  /** Moves a job and its history `hours` into the past. Used by the demo so its timeline looks lived-in. */
  backdate(jobId: number, hours: number): void {
    const shift = `-${Math.round(hours * 60)} minutes`;
    this.db.transaction(() => {
      this.db
        .query(
          "UPDATE jobs SET created_at = datetime(created_at, ?), updated_at = datetime(updated_at, ?) WHERE id = ?",
        )
        .run(shift, shift, jobId);
      this.db.query("UPDATE events SET at = datetime(at, ?) WHERE job_id = ?").run(shift, jobId);
    })();
  }

  /** Applications per day for the last `days` days (UTC dates), oldest first. */
  appliedPerDay(days: number): { day: string; n: number }[] {
    return this.db
      .query(
        `SELECT date(at) AS day, COUNT(*) AS n FROM events
         WHERE kind = 'status' AND to_status = 'applied' AND date(at) >= date('now', ?)
         GROUP BY day ORDER BY day`,
      )
      .all(`-${days - 1} days`) as { day: string; n: number }[];
  }

  /** Has the user already engaged with this company (applied or beyond), or is another role there in flight? */
  companyStatuses(company: string, excludeId?: number): JobStatus[] {
    const rows = this.db
      .query("SELECT status FROM jobs WHERE lower(company) = lower(?) AND id != ?")
      .all(company, excludeId ?? -1) as { status: JobStatus }[];
    return rows.map((r) => r.status);
  }

  getKv(key: string): string | null {
    return (this.db.query("SELECT v FROM kv WHERE k = ?").get(key) as { v: string } | null)?.v ?? null;
  }

  setKv(key: string, value: string): void {
    this.db
      .query("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .run(key, value);
  }

  hasMail(id: string): boolean {
    return this.db.query("SELECT 1 FROM mail WHERE id = ?").get(id) !== null;
  }

  saveMail(m: {
    id: string;
    provider: string;
    msg: { receivedAt: string; fromAddress: string; fromName: string; subject: string; text: string };
    kind: string;
    reason: string;
    jobId: number | null;
  }): void {
    this.db
      .query(
        `INSERT OR IGNORE INTO mail (id, provider, received_at, from_addr, from_name, subject, preview, kind, reason, job_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.provider,
        m.msg.receivedAt,
        m.msg.fromAddress,
        m.msg.fromName,
        m.msg.subject,
        m.msg.text.slice(0, 500),
        m.kind,
        m.reason,
        m.jobId,
      );
  }

  listMail(limit = 200): MailRow[] {
    return this.db.query("SELECT * FROM mail ORDER BY received_at DESC LIMIT ?").all(limit) as MailRow[];
  }
}

export interface MailRow {
  id: string;
  provider: string;
  received_at: string;
  from_addr: string;
  from_name: string;
  subject: string;
  preview: string;
  kind: string;
  reason: string;
  job_id: number | null;
  seen: number;
}
