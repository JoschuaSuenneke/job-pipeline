// SQLite storage with forward-only migrations. One file per workspace, owned by the user.
import { Database } from "bun:sqlite";

const MIGRATIONS: string[] = [
  `CREATE TABLE jobs (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     fingerprint   TEXT NOT NULL UNIQUE,
     title         TEXT NOT NULL,
     company       TEXT NOT NULL,
     url           TEXT NOT NULL,
     location      TEXT NOT NULL DEFAULT '',
     work_mode     TEXT NOT NULL DEFAULT 'unknown',
     description   TEXT NOT NULL DEFAULT '',
     salary_min    REAL,
     salary_max    REAL,
     currency      TEXT NOT NULL DEFAULT 'EUR',
     posted_at     TEXT,
     apply_method  TEXT NOT NULL DEFAULT 'unknown',
     apply_email   TEXT,
     source        TEXT NOT NULL,
     status        TEXT NOT NULL DEFAULT 'new',
     fit_score     INTEGER,
     fit_reasons   TEXT NOT NULL DEFAULT '[]',
     created_at    TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX jobs_status ON jobs(status);
   CREATE INDEX jobs_company ON jobs(lower(company));

   CREATE TABLE events (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     job_id     INTEGER REFERENCES jobs(id),
     at         TEXT NOT NULL DEFAULT (datetime('now')),
     actor      TEXT NOT NULL,
     kind       TEXT NOT NULL,
     from_status TEXT,
     to_status  TEXT,
     note       TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX events_job ON events(job_id);

   CREATE TABLE documents (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     job_id     INTEGER NOT NULL REFERENCES jobs(id),
     kind       TEXT NOT NULL,
     language   TEXT NOT NULL DEFAULT 'en',
     body       TEXT NOT NULL,
     fact_ids   TEXT NOT NULL DEFAULT '[]',
     path       TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );

   CREATE TABLE approvals (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     job_id     INTEGER REFERENCES jobs(id),
     action     TEXT NOT NULL,
     scope      TEXT NOT NULL,
     wording    TEXT NOT NULL,
     granted_by TEXT NOT NULL,
     granted_at TEXT NOT NULL DEFAULT (datetime('now')),
     used_at    TEXT
   );

   CREATE TABLE mail (
     id          TEXT PRIMARY KEY,
     provider    TEXT NOT NULL,
     received_at TEXT NOT NULL,
     from_addr   TEXT NOT NULL,
     from_name   TEXT NOT NULL DEFAULT '',
     subject     TEXT NOT NULL DEFAULT '',
     preview     TEXT NOT NULL DEFAULT '',
     kind        TEXT NOT NULL,
     reason      TEXT NOT NULL DEFAULT '',
     job_id      INTEGER REFERENCES jobs(id),
     seen        INTEGER NOT NULL DEFAULT 0
   );

   CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
];

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}
