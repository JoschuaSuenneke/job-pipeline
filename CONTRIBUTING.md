# Contributing

Thanks for helping. Four principles keep the project useful and safe:

1. **Local-first.** No telemetry, no hosted backend. Nothing leaves the user's machine unless they ask.
2. **Rules in code.** Anything that protects users or employers (approvals, blocklist, limits, consents) belongs in `src/core/policy.ts`, not only in a prompt.
3. **Official sources only.** New job sources use an official API or a public feed. No scraping of sites whose terms forbid it.
4. **No fabrication.** Documents are built from confirmed facts, and `src/cv/factcheck.ts` stays strict.

## Development

```bash
bun install
bun test
bun run typecheck && bun run lint
```

**New source adapter:** implement `SourceAdapter` in `src/sources/`, register it in `src/sources/registry.ts`, add a recorded fixture and a test. Tests never hit the network.
