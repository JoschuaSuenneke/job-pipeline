import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.ts";
import { tempApp } from "../core/helpers.ts";

async function connect() {
  const app = tempApp();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(app).connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]?.text ?? "null";
    return { error: Boolean(res.isError), data: JSON.parse(text) };
  };
  return { app, client, call };
}

describe("MCP server", () => {
  test("exposes the documented tools", async () => {
    const { app, client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      "get_profile",
      "propose_facts",
      "confirm_fact",
      "triage_job",
      "build_cv",
      "save_cover_note",
      "record_approval",
      "submit_check",
      "mark_applied",
      "sync_mail",
    ]) {
      expect(names).toContain(n);
    }
    app.close();
  });

  test("facts start unconfirmed and need the user's words", async () => {
    const { app, call } = await connect();
    await call("propose_facts", {
      facts: [{ id: "f1", section: "skill", text: "SQL (basic)", source: "cv" }],
    });
    expect((await call("list_facts", { onlyConfirmed: true })).data).toEqual([]);
    expect((await call("confirm_fact", { id: "f1", userWords: "yes, correct" })).data.confirmed).toBe(true);
    app.close();
  });

  test("submission needs a recorded go; the policy refuses without it", async () => {
    const { app, call } = await connect();
    const [id] = app.repo.insertJobs([
      {
        title: "Product Manager",
        company: "Acme",
        url: "https://acme.example/1",
        location: "Münster",
        source: "t",
      },
    ]) as [number];
    app.repo.setStatus(id, "drafted", "agent");
    expect((await call("submit_check", { id })).data.allowed).toBe(false);
    expect((await call("set_status", { id, status: "approved" })).error).toBe(true);
    await call("record_approval", { id, userWords: "go for Acme" });
    expect((await call("submit_check", { id })).data).toEqual({ allowed: true, approval: "go for Acme" });
    expect(
      (await call("mark_applied", { id, summary: "Ashby form, confirmation page seen" })).data.status,
    ).toBe("applied");
    app.close();
  });

  test("cover notes with invented claims are rejected", async () => {
    const { app, call } = await connect();
    const [id] = app.repo.insertJobs([
      {
        title: "Product Manager",
        company: "Acme",
        url: "https://acme.example/2",
        location: "Münster",
        source: "t",
      },
    ]) as [number];
    const res = await call("save_cover_note", {
      id,
      text: "At Google I grew revenue by 300% and I would love to bring that to your team.",
    });
    expect(res.error).toBe(true);
    app.close();
  });
});
