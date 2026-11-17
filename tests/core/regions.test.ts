import { describe, expect, test } from "bun:test";
import { remoteOpenTo } from "../../src/core/regions.ts";
import { Config, RawJob } from "../../src/core/schema.ts";
import { screen } from "../../src/core/screening.ts";
import { testConfig } from "./helpers.ts";

describe("remote regions", () => {
  test("a US candidate gets US and Americas roles, not EU-only ones", () => {
    expect(remoteOpenTo("Remote (US)", ["US"])).toBe(true);
    expect(remoteOpenTo("Remote - United States", ["US"])).toBe(true);
    expect(remoteOpenTo("North America", ["US"])).toBe(true);
    expect(remoteOpenTo("Anywhere", ["US"])).toBe(true);
    expect(remoteOpenTo("Remote (EMEA)", ["US"])).toBe(false);
    expect(remoteOpenTo("Europe", ["US"])).toBe(false);
  });
  test("a two-letter code only matches as a word", () => {
    expect(remoteOpenTo("Houston, Texas", ["US"])).toBe(false);
    expect(remoteOpenTo("Australia", ["US"])).toBe(false);
  });
  test("a German candidate gets EU, EMEA and DACH roles, not US-only ones", () => {
    for (const place of ["Remote (EU)", "EMEA", "DACH", "Deutschland", "Germany"])
      expect(remoteOpenTo(place, ["DE"])).toBe(true);
    expect(remoteOpenTo("Remote (US only)", ["DE"])).toBe(false);
  });
  test("plain country names in the config still work", () => {
    expect(remoteOpenTo("Remote, Portugal", ["Portugal"])).toBe(true);
  });
});

describe("screening for a San Francisco candidate", () => {
  const sf = Config.parse({
    ...testConfig,
    candidate: { ...testConfig.candidate, home: "San Francisco", country: "US" },
    targets: { ...testConfig.targets, roles: ["software engineer"] },
    location: {
      remoteCountries: ["US"],
      tiers: [{ label: "Bay Area", places: ["San Francisco", "Oakland", "Palo Alto"], maxOfficeDays: 3 }],
    },
    compensation: { currency: "USD", floor: 160000, ask: 190000 },
  });
  const job = (over: Record<string, unknown>) =>
    RawJob.parse({
      title: "Software Engineer",
      company: "Acme",
      url: "https://acme.example/1",
      source: "t",
      ...over,
    });

  test("keeps Bay Area hybrid and US remote roles, drops EU remote and other cities", () => {
    expect(screen(job({ location: "San Francisco, CA", workMode: "hybrid" }), sf).decision).toBe("keep");
    expect(screen(job({ location: "Remote (US)", workMode: "remote" }), sf).decision).toBe("keep");
    expect(screen(job({ location: "Remote (EU)", workMode: "remote" }), sf).decision).toBe("drop");
    expect(screen(job({ location: "New York, NY", workMode: "onsite" }), sf).decision).toBe("drop");
  });
  test("compares pay only in the user's currency", () => {
    const at = { location: "San Francisco, CA" };
    expect(screen(job({ ...at, salaryMax: 140000, currency: "USD" }), sf).decision).toBe("drop");
    expect(screen(job({ ...at, salaryMax: 140000, currency: "EUR" }), sf).decision).toBe("keep");
    expect(screen(job({ ...at, salaryMax: 210000, currency: "USD" }), sf)).toMatchObject({
      decision: "keep",
    });
  });
});
