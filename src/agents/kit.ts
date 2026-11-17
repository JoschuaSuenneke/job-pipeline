// Writes the driver kit into the workspace: CLAUDE.md, AGENTS.md, .mcp.json and a Claude Code skill.
// Opening Claude Code or Codex in the workspace folder is all a user needs to do afterwards.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../core/schema.ts";
import type { Workspace } from "../core/workspace.ts";
import { renderManual } from "./manual.ts";

/** Absolute path of the MCP server entry in this installation. */
export const MCP_ENTRY = resolve(import.meta.dir, "..", "mcp", "server.ts");

export interface KitResult {
  written: string[];
  /** Codex reads MCP servers from ~/.codex/config.toml; we print this instead of editing the user's file. */
  codexSnippet: string;
}

function mcpServerSpec(ws: Workspace) {
  return { command: "bun", args: [MCP_ENTRY], env: { JOB_PIPELINE_HOME: ws.root } };
}

/** Writes the kit for the drivers chosen in the config. Safe to re-run after config changes. */
export function writeAgentKit(ws: Workspace, config: Config): KitResult {
  const manual = renderManual(config);
  const written: string[] = [];
  const write = (rel: string, content: string) => {
    const path = join(ws.root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
    written.push(path);
  };

  const drivers = new Set(config.agent.drivers);
  if (drivers.has("claude")) {
    write("CLAUDE.md", manual);
    write(".mcp.json", `${JSON.stringify({ mcpServers: { "job-pipeline": mcpServerSpec(ws) } }, null, 2)}\n`);
    write(
      ".claude/skills/job-pipeline/SKILL.md",
      `---\nname: job-pipeline\ndescription: Run ${config.candidate.name}'s job search: onboarding, scouting, triage, tailored CVs and cover notes, applications with approval, inbox. Use for anything about jobs, applications or the pipeline.\n---\n\n${manual}`,
    );
  }
  if (drivers.has("codex") || drivers.has("generic-mcp")) write("AGENTS.md", manual);

  const spec = mcpServerSpec(ws);
  const codexSnippet = `[mcp_servers.job-pipeline]\ncommand = "${spec.command}"\nargs = ["${MCP_ENTRY}"]\nenv = { JOB_PIPELINE_HOME = "${ws.root}" }\n`;
  return { written, codexSnippet };
}
