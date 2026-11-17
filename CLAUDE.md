# Working on job-pipeline

This file is for sessions that change this repo. The manual for users' agents lives in `src/agents/manual.ts`.

## Before you change anything

- Run `bun test && bun run typecheck && bun run lint`. All three must pass before and after.
- Read the commit that introduced a thing (`git log -S <name>`) before removing or reshaping it.
- Prefer deleting over simplifying, simplifying over optimizing, optimizing over automating. Don't remove features.

## Where things go (one obvious place each)

| Concern | Place |
|---|---|
| Schemas, statuses, config shape | `src/core/schema.ts` |
| What the agent may or may not do | `src/core/policy.ts` |
| Company and title matching | `src/core/names.ts` |
| SQL | `src/db/` only (a test enforces this) |
| A new job source | `src/sources/<name>.ts` implementing `SourceAdapter`, registered in `registry.ts`, with a fixture test |
| A new mail provider | `src/mail/<name>.ts` implementing `MailProvider` |
| A new agent capability | an MCP tool in `src/mcp/tools-*.ts`, mentioned in `src/agents/manual.ts` (a test checks every mentioned tool exists) |
| Wizards talking to a person | the `Prompter` interface in `src/core/prompter.ts` |

## Standard

- Descriptive names, one purpose per file, no copy-pasted helpers: search for an existing one first.
- Parse every boundary with zod (config, API bodies, adapter output, MCP input).
- Tests never hit the network; record a fixture.
- No personal data in `src/` (a test enforces this).

## To stop a mistake, prefer in this order

A check that fails, then a type, then one obvious place, then a good example nearby. A written rule like this file comes last.
