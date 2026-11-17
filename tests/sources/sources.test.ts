import { describe, expect, test } from "bun:test";
import { RawJob } from "../../src/core/schema.ts";
import { parseBaJob, searchPlaces } from "../../src/sources/arbeitsagentur.ts";
import {
  atsFromUrl,
  candidateSlugs,
  parseAshby,
  parseGreenhouse,
  parsePersonio,
  workdayParts,
} from "../../src/sources/ats.ts";
import { detectWorkMode, htmlToText, parseSalary } from "../../src/sources/normalize.ts";
import { parseRemoteOk, parseWeWorkRemotely } from "../../src/sources/remote-boards.ts";
import { runScout } from "../../src/sources/scout.ts";
import type { SourceAdapter } from "../../src/sources/types.ts";
import { tempApp } from "../core/helpers.ts";

const acme = { name: "Acme", ats: "ashby", slug: "acme" };
const valid = (jobs: unknown[]) => jobs.every((j) => RawJob.safeParse(j).success);

describe("normalisation", () => {
  test("turns board HTML into readable text", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>one</li><li>two</li></ul>")).toBe(
      "Hello world\n• one\n• two",
    );
  });
  test("parses common salary notations", () => {
    expect(parseSalary("€60,000 – €75,000 per year")).toEqual({
      salaryMin: 60000,
      salaryMax: 75000,
      currency: "EUR",
    });
    expect(parseSalary("60k-75k EUR")).toEqual({ salaryMin: 60000, salaryMax: 75000, currency: "EUR" });
    expect(parseSalary("EUR 55.000 bis 65.000")).toEqual({
      salaryMin: 55000,
      salaryMax: 65000,
      currency: "EUR",
    });
    expect(parseSalary("3-5 years")).toEqual({});
  });
  test("detects work mode from structured and free-text hints", () => {
    expect(detectWorkMode(true)).toBe("remote");
    expect(detectWorkMode("Berlin (Hybrid)")).toBe("hybrid");
    expect(detectWorkMode("100% Homeoffice möglich")).toBe("remote");
    expect(detectWorkMode("Munich")).toBe("unknown");
  });
});

describe("ATS parsers", () => {
  test("Ashby", () => {
    const jobs = parseAshby(
      {
        jobs: [
          {
            title: "Product Manager",
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            location: "Berlin",
            isRemote: true,
            descriptionPlain: "Own discovery.",
            compensation: { compensationTierSummary: "€70K – €85K" },
          },
          { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/2", isListed: false },
        ],
      },
      acme,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      workMode: "remote",
      salaryMin: 70000,
      salaryMax: 85000,
      source: "ashby:acme",
    });
    expect(valid(jobs)).toBe(true);
  });

  test("Greenhouse", () => {
    const jobs = parseGreenhouse(
      {
        jobs: [
          {
            title: "Analyst",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            location: { name: "Remote - Germany" },
            content: "&lt;p&gt;Data&lt;/p&gt;",
          },
        ],
      },
      { ...acme, ats: "greenhouse" },
    );
    expect(jobs[0]).toMatchObject({ workMode: "remote", description: "Data" });
    expect(valid(jobs)).toBe(true);
  });

  test("Personio XML", () => {
    const xml = `<workzag-jobs><position><id>42</id><office>Münster</office><name>Business Analyst (m/w/d)</name>
      <jobDescriptions><jobDescription><value><![CDATA[<p>Prozesse analysieren</p>]]></value></jobDescription></jobDescriptions>
      <createdAt>2026-11-01T10:00:00+00:00</createdAt></position></workzag-jobs>`;
    const jobs = parsePersonio(xml, { ...acme, ats: "personio" });
    expect(jobs[0]).toMatchObject({
      url: "https://acme.jobs.personio.de/job/42",
      location: "Münster",
      description: "Prozesse analysieren",
    });
    expect(valid(jobs)).toBe(true);
  });

  test("slug helpers", () => {
    expect(candidateSlugs("Acme Labs GmbH")).toEqual(["acmelabs", "acme-labs", "acme"]);
    expect(atsFromUrl("https://job-boards.eu.greenhouse.io/acme/jobs/1")).toEqual({
      ats: "greenhouse",
      slug: "acme",
    });
    expect(atsFromUrl("https://acme.wd3.myworkdayjobs.com/en-US/Careers")).toEqual({
      ats: "workday",
      slug: "acme/Careers/wd3",
    });
    expect(workdayParts("acme/Careers/wd3").host).toBe("acme.wd3.myworkdayjobs.com");
  });
});

describe("boards and Arbeitsagentur", () => {
  test("Remote OK skips the legal notice row", () => {
    const jobs = parseRemoteOk([
      { position: undefined },
      { position: "Ops Lead", company: "Co", url: "https://remoteok.com/1", location: "Europe" },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.location).toBe("Remote (Europe)");
  });
  test("We Work Remotely splits Company: Role", () => {
    const rss = `<rss><item><title>Acme: Customer Success Manager</title><link>https://weworkremotely.com/x</link><region>Europe</region></item></rss>`;
    expect(parseWeWorkRemotely(rss)[0]).toMatchObject({ company: "Acme", title: "Customer Success Manager" });
  });
  test("reads the current v6 field names (firma, referenznummer, stellenlokationen)", () => {
    const job = parseBaJob(
      {
        referenznummer: "12811-2366441-S",
        stellenangebotsTitel: "Product Owner (m/w/d)",
        firma: "Stadtwerke Beispiel AG",
        stellenlokationen: [{ adresse: { ort: "Osnabrück", land: "DEUTSCHLAND" } }],
        alleBerufe: ["Product Owner"],
      },
      "Münster",
    );
    expect(job).toMatchObject({
      company: "Stadtwerke Beispiel AG",
      url: "https://www.arbeitsagentur.de/jobsuche/jobdetail/12811-2366441-S",
      location: "Osnabrück (near Münster), Germany",
    });
  });

  test("BA rows become jobs; remote titles are remote", () => {
    const job = parseBaJob(
      {
        refnr: "10000-1",
        titel: "Projektmanager (m/w/d) 100% Remote",
        arbeitgeber: "Acme GmbH",
        arbeitsort: { ort: "Köln" },
      },
      "Münster",
    );
    expect(job).toMatchObject({ workMode: "remote", location: "Köln (near Münster), Germany" });
    expect(parseBaJob({ titel: "No ref" })).toBeNull();
  });
  test("searches around home and commute-tier places", () => {
    const app = tempApp();
    expect(searchPlaces(app.config).map((p) => p.wo)).toEqual(["Münster", "Osnabrück", "Köln", "Düsseldorf"]);
    app.close();
  });
});

describe("scout", () => {
  test("stores new jobs once, screens them and isolates failing adapters", async () => {
    const app = tempApp();
    const good: SourceAdapter = {
      id: "fake",
      name: "Fake",
      countries: ["*"],
      access: "public-feed",
      fetchJobs: async () => [
        {
          title: "Product Manager",
          company: "Acme",
          url: "https://acme.example/1",
          location: "Münster",
          source: "fake",
        },
        {
          title: "Senior Product Manager",
          company: "Beta",
          url: "https://beta.example/1",
          location: "Münster",
          source: "fake",
        },
        {
          title: "Truck Driver",
          company: "Gamma",
          url: "https://gamma.example/1",
          location: "Münster",
          source: "fake",
        },
      ],
    };
    const broken: SourceAdapter = {
      ...good,
      id: "broken",
      fetchJobs: async () => Promise.reject(new Error("boom")),
    };

    const first = await runScout(app, { adapters: [good, broken] });
    expect(first).toMatchObject({ fetched: 3, new: 3, kept: 1, parked: 1, dropped: 1 });
    expect(first.errors.some((e) => e.includes("boom"))).toBe(true);

    const second = await runScout(app, { adapters: [good] });
    expect(second.new).toBe(0);
    app.close();
  });
});
