import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Config, Fact } from "../../src/core/schema.ts";
import { checkClaims } from "../../src/cv/factcheck.ts";
import { renderCvHtml } from "../../src/cv/render.ts";
import { buildCv } from "../../src/cv/select.ts";

const dir = join(import.meta.dir, "..", "..", "examples", "erika");
const config = Config.parse(YAML.parse(readFileSync(join(dir, "job-pipeline.config.yaml"), "utf8")));
const facts = Fact.array().parse(YAML.parse(readFileSync(join(dir, "facts.yaml"), "utf8")));

describe("CV per job", () => {
  test("uses only confirmed facts and records which ones", () => {
    const cv = buildCv(facts, config);
    expect(cv.factIds).not.toContain("unconfirmed-claim");
    expect(cv.notes.some((n) => n.includes("unconfirmed"))).toBe(true);
    expect(cv.experience.map((e) => e.organisation)).toEqual(["Acme Logistics GmbH", "Beta Insurance AG"]);
  });

  test("puts the most relevant bullets first for each job", () => {
    const analyst = buildCv(facts, config, {
      job: { title: "Business Analyst", description: "BPMN, requirements and process automation" },
    });
    expect(analyst.experience[0]?.bullets[0]?.factId).toBe("acme-automation");
    expect(analyst.experience[1]?.bullets[0]?.factId).toBe("beta-requirements");

    const csm = buildCv(facts, config, {
      job: { title: "Customer Success Manager", description: "onboarding and activation of SMB customers" },
      maxBullets: 3,
    });
    expect(csm.experience[0]?.bullets[0]?.factId).toBe("acme-onboarding");
    expect(csm.experience.flatMap((e) => e.bullets)).toHaveLength(3);
  });

  test("renders escaped, ATS-friendly HTML in the CV language", () => {
    const html = renderCvHtml(buildCv(facts, config, { language: "de" }));
    expect(html).toContain("<h2>Berufserfahrung</h2>");
    expect(html).toContain("Erika Mustermann");
    expect(html).not.toContain("Led a team of 12");
  });
});

describe("fact check", () => {
  test("accepts claims that confirmed facts back", () => {
    const text =
      "At Acme Logistics I ran 40+ customer interviews and raised 30-day activation from 41% to 58%. I automate processes with n8n.";
    expect(checkClaims(text, facts).issues).toEqual([]);
  });

  test("flags invented numbers, tools, employers, dashes and length", () => {
    const text = "At Google I grew revenue by 300% in HubSpot — and led a team of 25.";
    const issues = checkClaims(text, facts, { maxWords: 10 }).issues;
    expect(issues.map((i) => `${i.kind}:${i.text}`)).toEqual([
      "number:300%",
      "number:25.",
      "tool:HubSpot",
      "organisation:Google",
      "style:—",
      "length:15 words",
    ]);
  });

  test("numbers from the job posting context are not claims", () => {
    expect(checkClaims("The role pays 75,000 EUR.", facts, { context: "Salary 75.000 €" }).ok).toBe(true);
  });
});
