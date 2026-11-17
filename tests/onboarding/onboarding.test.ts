import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_ENTRY } from "../../src/agents/kit.ts";
import type { Prompter } from "../../src/core/prompter.ts";
import { resolveWorkspace } from "../../src/core/workspace.ts";
import { importCv } from "../../src/onboarding/import-cv.ts";
import { runInit } from "../../src/onboarding/init.ts";

/** Answers questions in order; any question not scripted takes its default. */
function scripted(answers: Record<string, string>): Prompter & { said: string[] } {
  const said: string[] = [];
  const answer = async (q: string, fallback?: string) => {
    const key = Object.keys(answers).find((k) => q.startsWith(k));
    return key ? (answers[key] as string) : (fallback ?? "");
  };
  return { said, ask: answer, secret: answer, say: (m) => said.push(m), open: () => undefined };
}

describe("init wizard", () => {
  test("writes a valid config and the agent kit for Claude and Codex", async () => {
    const ws = resolveWorkspace(mkdtempSync(join(tmpdir(), "jp-init-")));
    const io = scripted({
      "Your name": "Erika Mustermann",
      "Email for applications": "erika@example.com",
      "Where do you live": "Münster",
      "Languages with level": "de:native, en:C1",
      "Target roles": "product owner, business analyst",
      "Places for hybrid roles": "Köln, Düsseldorf",
      "Lowest yearly salary": "60000",
      "Salary you ask for": "70000",
      "Never apply to": "Example Bank Group",
      "Agent(s) you use": "claude, codex",
    });
    const config = await runInit(ws, io);

    expect(config.targets.roles).toEqual(["product owner", "business analyst"]);
    expect(config.location.tiers.map((t) => t.label)).toEqual(["daily commute", "hybrid"]);
    expect(config.sources.enabled).toContain("arbeitsagentur");
    expect(config.rules.consents.termsOfUse).toBe(false);

    const manual = readFileSync(join(ws.root, "CLAUDE.md"), "utf8");
    expect(manual).toContain("Erika Mustermann");
    expect(manual).toContain("Example Bank Group");
    expect(existsSync(join(ws.root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(ws.root, ".claude/skills/job-pipeline/SKILL.md"))).toBe(true);
    const mcp = JSON.parse(readFileSync(join(ws.root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["job-pipeline"].args).toEqual([MCP_ENTRY]);
    expect(mcp.mcpServers["job-pipeline"].env.JOB_PIPELINE_HOME).toBe(ws.root);
    expect(io.said.join("\n")).toContain("[mcp_servers.job-pipeline]");
  });

  test("keeps an existing config unless the user starts over", async () => {
    const ws = resolveWorkspace(mkdtempSync(join(tmpdir(), "jp-init-")));
    await runInit(
      ws,
      scripted({
        "Your name": "A",
        "Email for applications": "a@example.com",
        "Where do you live": "X",
        "Target roles": "analyst",
      }),
    );
    const kept = await runInit(ws, scripted({ "A config exists": "n" }));
    expect(kept.candidate.name).toBe("A");
  });
});

describe("CV import", () => {
  test("copies text CVs into the workspace for the agent", () => {
    const ws = resolveWorkspace(mkdtempSync(join(tmpdir(), "jp-cv-")));
    const file = join(ws.root, "..", `cv-${Date.now()}.md`);
    writeFileSync(file, "# Erika\nProduct Owner at Acme");
    const r = importCv({ ...ws, cvDir: ws.root }, file);
    expect(r.method).toBe("plain");
    expect(readFileSync(r.textPath, "utf8")).toContain("Product Owner");
  });
});
