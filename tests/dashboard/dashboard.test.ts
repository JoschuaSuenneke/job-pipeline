import { describe, expect, test } from "bun:test";
import { createDashboard } from "../../src/dashboard/server.ts";
import { tempApp } from "../core/helpers.ts";

const PORT = 4747;
const base = `http://127.0.0.1:${PORT}`;
const json = (body: unknown, origin = base) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin, host: `127.0.0.1:${PORT}` },
  body: JSON.stringify(body),
});

function setup() {
  const app = tempApp();
  const [id] = app.repo.insertJobs([
    {
      title: "Product Owner",
      company: "Acme",
      url: "https://acme.example/1",
      location: "Münster",
      source: "test",
    },
  ]) as [number];
  app.repo.setStatus(id, "drafted", "agent");
  return { app, id, http: createDashboard(app, PORT) };
}

describe("dashboard API", () => {
  test("summary and job list", async () => {
    const { app, http } = setup();
    const summary = (await (
      await http.request(`${base}/api/summary`, { headers: { host: `127.0.0.1:${PORT}` } })
    ).json()) as { counts: Record<string, number>; appliedPerDay: unknown[] };
    expect(summary.counts.drafted).toBe(1);
    expect(summary.appliedPerDay).toHaveLength(14);
    const jobs = await (
      await http.request(`${base}/api/jobs?status=drafted`, { headers: { host: `127.0.0.1:${PORT}` } })
    ).json();
    expect(jobs).toHaveLength(1);
    app.close();
  });

  test("approval records the user's words and makes the job submittable", async () => {
    const { app, id, http } = setup();
    const res = await http.request(`${base}/api/jobs/${id}/approve`, json({ wording: "Go, send it" }));
    expect(res.status).toBe(200);
    expect(app.repo.getJob(id)?.status).toBe("approved");
    expect(app.policy.submitApplication(id)).toEqual({ allowed: true, approval: "Go, send it" });
    app.close();
  });

  test("rejects empty approvals, invalid transitions, cross-origin writes and foreign hosts", async () => {
    const { app, id, http } = setup();
    expect((await http.request(`${base}/api/jobs/${id}/approve`, json({ wording: "" }))).status).toBe(400);
    expect((await http.request(`${base}/api/jobs/${id}/status`, json({ to: "offer" }))).status).toBe(400);
    expect(
      (await http.request(`${base}/api/jobs/${id}/status`, json({ to: "parked" }, "https://evil.example")))
        .status,
    ).toBe(403);
    expect((await http.request(`${base}/api/summary`, { headers: { host: "evil.example" } })).status).toBe(
      403,
    );
    expect(app.repo.getJob(id)?.status).toBe("drafted");
    app.close();
  });

  test("config updates are validated", async () => {
    const { app, http } = setup();
    const bad = await http.request(`${base}/api/config`, { ...json({ version: 2 }), method: "PUT" });
    expect(bad.status).toBe(400);
    const good = await http.request(`${base}/api/config`, {
      ...json({ ...app.config, compensation: { ...app.config.compensation, floor: 65000 } }),
      method: "PUT",
    });
    expect(good.status).toBe(200);
    expect(app.config.compensation.floor).toBe(65000);
    app.close();
  });
});
