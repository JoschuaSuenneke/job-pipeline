import { describe, expect, test } from "bun:test";
import { Config, RawJob } from "../../src/core/schema.ts";
import { maxYearsRequired, screen } from "../../src/core/screening.ts";
import { canTransition } from "../../src/core/status.ts";
import { fingerprint } from "../../src/db/repository.ts";
import { tempApp, testConfig } from "./helpers.ts";

const config = Config.parse(testConfig);
const job = (over: Partial<Record<string, unknown>> = {}) =>
  RawJob.parse({
    title: "Product Manager",
    company: "Acme",
    url: "https://acme.example/jobs/1",
    source: "test",
    ...over,
  });

describe("screening", () => {
  test("keeps a matching remote role in an allowed country", () => {
    const v = screen(job({ workMode: "remote", location: "Germany" }), config);
    expect(v.decision).toBe("keep");
  });
  test("drops blocklisted companies, parks senior titles", () => {
    expect(screen(job({ company: "Evil Corp GmbH" }), config).decision).toBe("drop");
    expect(screen(job({ title: "Senior Product Manager", location: "Münster" }), config).decision).toBe(
      "park",
    );
  });
  test("drops roles asking for too many years or paying below the floor", () => {
    expect(
      screen(job({ location: "Münster", description: "You bring 8+ years of experience." }), config).decision,
    ).toBe("drop");
    expect(screen(job({ location: "Münster", salaryMax: 50000 }), config).decision).toBe("drop");
  });
  test("drops places outside the commute tiers", () => {
    expect(screen(job({ location: "München", workMode: "onsite" }), config).decision).toBe("drop");
  });
  test("drops unpaid, internship and part-time roles by default (found in the end-to-end run)", () => {
    const at = { location: "Münster" };
    expect(screen(job({ ...at, title: "Product Owner (Volunteer, unpaid)" }), config).decision).toBe("drop");
    expect(screen(job({ ...at, title: "Werkstudent Product Management" }), config).decision).toBe("drop");
    expect(screen(job({ ...at, title: "Business Analyst befristet & in Teilzeit" }), config).decision).toBe(
      "drop",
    );
    expect(screen(job({ ...at, title: "Business Analyst" }), config).decision).toBe("keep");
  });
  test("reads years in English and German", () => {
    expect(maxYearsRequired("mindestens 3 Jahre Erfahrung, ideally 4+ years")).toBe(4);
    expect(maxYearsRequired("no requirement")).toBeNull();
  });
});

describe("state machine and fingerprint", () => {
  test("allows only valid transitions", () => {
    expect(canTransition("drafted", "approved")).toBe(true);
    expect(canTransition("new", "applied")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
  });
  test("treats the same role at the same company as one job", () => {
    expect(fingerprint("Acme GmbH", "Product Manager (m/w/d)")).toBe(fingerprint("ACME", "Product Manager"));
  });
});

describe("policy", () => {
  test("refuses to submit without approval, allows once with it, then refuses again", () => {
    const app = tempApp();
    const [id] = app.repo.insertJobs([job({ location: "Münster" })]) as [number];
    app.repo.setStatus(id, "drafted", "agent");
    expect(app.policy.submitApplication(id).allowed).toBe(false);

    app.repo.grantApproval({
      jobId: id,
      action: "submit_application",
      scope: "job",
      wording: "go",
      grantedBy: "user",
    });
    app.repo.setStatus(id, "approved", "user");
    expect(app.policy.submitApplication(id)).toEqual({ allowed: true, approval: "go" });
    expect(app.policy.submitApplication(id).allowed).toBe(false); // approval is single-use
    app.close();
  });

  test("enforces one role per company", () => {
    const app = tempApp();
    const [a, b] = app.repo.insertJobs([
      job(),
      job({ title: "Business Analyst", url: "https://acme.example/jobs/2" }),
    ]) as [number, number];
    for (const id of [a, b]) app.repo.setStatus(id, "drafted", "agent");
    app.repo.setStatus(a, "applied", "agent");
    app.repo.grantApproval({
      jobId: b,
      action: "submit_application",
      scope: "job",
      wording: "go",
      grantedBy: "user",
    });
    app.repo.setStatus(b, "approved", "user");
    const d = app.policy.submitApplication(b);
    expect(d.allowed).toBe(false);
    app.close();
  });

  test("never ticks an untrue declaration and respects consent levels", () => {
    const app = tempApp();
    expect(app.policy.tickConsent("privacy", true).allowed).toBe(true);
    expect(app.policy.tickConsent("termsOfUse", true).allowed).toBe(false);
    expect(app.policy.tickConsent("privacy", false).allowed).toBe(false);
    app.close();
  });
});
