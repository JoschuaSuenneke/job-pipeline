// Checks that keep the codebase honest for the next session (human or agent). A failing check beats a written rule.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { renderManual } from "../src/agents/manual.ts";
import { JOB_STATUSES } from "../src/core/schema.ts";
import { createMcpServer } from "../src/mcp/server.ts";
import { tempApp } from "./core/helpers.ts";

const ROOT = join(import.meta.dir, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("conventions", () => {
  test("every tool the agent manual mentions exists on the MCP server", async () => {
    const app = tempApp();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(app).connect(serverSide);
    const client = new Client({ name: "check", version: "1" });
    await client.connect(clientSide);
    const tools = new Set((await client.listTools()).tools.map((t) => t.name));

    const mentioned = [...renderManual(app.config).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(
      (m) => m[1] as string,
    );
    const missing = [...new Set(mentioned)].filter((name) => !tools.has(name));
    expect(missing).toEqual([]);
    app.close();
  });

  test("the dashboard knows exactly the statuses the domain defines", () => {
    const ui = readFileSync(join(ROOT, "src/dashboard/ui/app.js"), "utf8");
    const list = ui.match(/const STATUSES = \[([\s\S]*?)\];/)?.[1] ?? "";
    const statuses = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...statuses].sort()).toEqual([...JOB_STATUSES].sort());
  });

  // Terms from a maintainer's own search (names, places, employers) live in the gitignored
  // .personal-patterns file, one regex per line, so the guard itself never publishes them.
  test("no personal data from a maintainer's own search is in the repo", () => {
    const file = join(ROOT, ".personal-patterns");
    if (!existsSync(file)) return;
    const terms = readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!terms.length) return;
    const personal = new RegExp(terms.join("|"), "i");
    const scanned = ["src", "tests", "examples", "docs"].flatMap((d) => files(join(ROOT, d)));
    const offenders = [...scanned, join(ROOT, "README.md")].filter((f) =>
      personal.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("only src/db writes SQL", () => {
    const sql = /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE)\b/;
    const offenders = files(join(ROOT, "src"))
      .filter((f) => !f.includes(`${join("src", "db")}`))
      .filter((f) => sql.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
