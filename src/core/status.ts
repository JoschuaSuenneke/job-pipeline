// The pipeline state machine. Every status change goes through `canTransition`.
import type { JobStatus } from "./schema.ts";

const NEXT: Record<JobStatus, readonly JobStatus[]> = {
  new: ["drafted", "dropped", "parked"],
  drafted: ["approved", "dropped", "parked", "applied"],
  approved: ["applied", "drafted", "dropped"],
  applied: ["conversation", "interview", "offer", "rejected"],
  conversation: ["interview", "offer", "rejected", "applied"],
  interview: ["offer", "rejected", "conversation"],
  offer: ["accepted", "rejected"],
  accepted: [],
  rejected: ["conversation", "interview"], // a "rejection" that turns out to be a misread receipt
  dropped: ["new", "drafted"],
  parked: ["new", "drafted", "dropped"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return from === to || NEXT[from].includes(to);
}

/** Statuses a job can move to next. The dashboard shows exactly these, so it never offers a refused change. */
export function nextStatuses(from: JobStatus): readonly JobStatus[] {
  return NEXT[from];
}

/** Statuses that count as "in the pipeline" (the user has engaged with the company). */
export const ACTIVE: readonly JobStatus[] = ["applied", "conversation", "interview", "offer", "accepted"];
