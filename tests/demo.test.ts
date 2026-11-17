import { expect, test } from "bun:test";
import { createDemo } from "../src/cli/demo.ts";
import { nextStatuses } from "../src/core/status.ts";

test("demo workspace has a fictional candidate and jobs in every main stage", () => {
  const app = createDemo();
  const counts = app.repo.countByStatus();
  for (const s of ["new", "drafted", "applied", "interview", "rejected", "parked", "dropped"]) {
    expect(counts[s] ?? 0).toBeGreaterThan(0);
  }
  expect(app.config.candidate.name).toBe("Sam Rivera");
  expect(createDemo("erika").config.candidate.country).toBe("DE");
  app.close();
});

test("a drafted job never offers interview or offer as next step", () => {
  expect(nextStatuses("drafted")).not.toContain("interview");
  expect(nextStatuses("accepted")).toEqual([]);
});
