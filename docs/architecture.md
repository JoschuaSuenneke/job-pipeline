# Architecture

job-pipeline splits the work between two parties:

- **The driver**, a Claude Code or Codex session (or any MCP client). It reads job descriptions, judges fit, interviews the user, writes CVs and cover notes, and fills application forms in the browser.
- **The code**, which keeps data, rules and integrations honest. It stores everything locally, fetches jobs from official sources, syncs mail, renders documents, checks claims against confirmed facts, and refuses actions the user has not allowed.

```
┌──────────────────────────┐        MCP (stdio)        ┌───────────────────────────────┐
│ Claude Code / Codex      │ ───────────────────────▶ │ src/mcp   tools               │
│ (reads, writes, decides) │ ◀─────────────────────── │ src/core  policy · screening  │
└──────────────────────────┘   results or refusals    │ src/db    SQLite + event log  │
            │                                          │ src/sources  ATS · boards     │
            │ browser automation (optional)            │ src/mail  IMAP · Gmail · MS   │
            ▼                                          │ src/cv    CV build · factcheck│
     employer application forms                        └──────────────┬────────────────┘
                                                                      │
                                     dashboard (127.0.0.1) ◀──────────┘  approvals by the user
```

## Layers

| Layer | Folder | Knows about |
|---|---|---|
| Domain | `src/core` | schemas, state machine, screening, policy |
| Storage | `src/db` | SQLite, migrations, repository |
| Integrations | `src/sources`, `src/mail`, `src/cv` | ports defined in core, external APIs |
| Interfaces | `src/mcp`, `src/cli`, `src/dashboard` | compose the layers above |

The domain never imports integrations or interfaces. Integrations implement small ports (`SourceAdapter`, `MailProvider`).

## Why rules live in code

A prompt can be ignored, forgotten after a context reset, or rewritten by text on a web page. So the actions that matter to the user and to employers go through `src/core/policy.ts`:

- **Submitting** needs status `approved`, and an unused approval holding the user's literal words. Each approval is single-use.
- **One role per company,** the **blocklist** and a **daily limit** are checked at submit time.
- **Consent boxes** are ticked only at the levels the user allowed, and never when the statement is untrue.
- **Email** is never sent: the code has no send function. Drafts only when `rules.emailDrafts` allows them.

The agent kit (`CLAUDE.md`, `AGENTS.md`, the skill) explains these rules, but the code enforces them.

## Data

Everything personal lives in the workspace (`~/.job-pipeline` or `$JOB_PIPELINE_HOME`):

```
job-pipeline.config.yaml   targets, location tiers, compensation, rules, sources, mail, drivers
facts.yaml                 everything true about the user, each fact with its source and a confirmed flag
pipeline.db                jobs, events, documents, approvals, mail
cv/                        source CV text, rendered CVs
out/                       generated PDFs and HTML
secrets/                   mail credentials and tokens (0600)
CLAUDE.md, AGENTS.md, .mcp.json, .claude/skills/   the driver kit, generated from the config
```
