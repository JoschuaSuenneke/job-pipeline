// The policy engine. The agent proposes, the code decides. Every outward action is checked here,
// so the same rules hold for Claude Code, Codex or any other MCP client, whatever their prompt says.
import type { Repository } from "../db/repository.ts";
import type { Config } from "./schema.ts";
import { ACTIVE } from "./status.ts";

export type ConsentKind = keyof Config["rules"]["consents"];

export type Decision = { allowed: true; approval?: string } | { allowed: false; reason: string };

export class Policy {
  constructor(
    private readonly config: Config,
    private readonly repo: Repository,
  ) {}

  /** Checks whether the agent may submit an application for this job right now. Consumes the approval. */
  submitApplication(jobId: number): Decision {
    const job = this.repo.getJob(jobId);
    if (!job) return { allowed: false, reason: `job ${jobId} not found` };
    if (job.status !== "approved") {
      return {
        allowed: false,
        reason: `job is "${job.status}"; the user must approve it first (status "approved")`,
      };
    }
    const rules = this.config.rules;
    if (rules.blocklist.some((b) => job.company.toLowerCase().includes(b.toLowerCase()))) {
      return { allowed: false, reason: `${job.company} is on the blocklist` };
    }
    if (rules.oneRolePerCompany) {
      const others = this.repo.companyStatuses(job.company, jobId);
      if (others.some((s) => ACTIVE.includes(s))) {
        return { allowed: false, reason: `already in process with ${job.company} (one role per company)` };
      }
    }
    if (this.repo.appliedToday() >= rules.dailyApplicationLimit) {
      return { allowed: false, reason: `daily limit of ${rules.dailyApplicationLimit} applications reached` };
    }
    const approval = this.repo.consumeApproval(jobId, "submit_application");
    if (!approval) return { allowed: false, reason: "no unused approval recorded for this job" };
    return { allowed: true, approval: approval.wording };
  }

  /** Drafts land in the user's mailbox for them to send. There is no send path anywhere in the code. */
  createEmailDraft(): Decision {
    return this.config.rules.emailDrafts
      ? { allowed: true }
      : { allowed: false, reason: "the user has not allowed email drafts (rules.emailDrafts)" };
  }

  /**
   * Consent boxes on application forms. `truthful` must be false whenever the statement would be untrue
   * (for example "no AI was used" when the agent drafted the text); those are never ticked.
   */
  tickConsent(kind: ConsentKind, truthful: boolean): Decision {
    if (!truthful) return { allowed: false, reason: "the statement is not true for the user; never tick it" };
    return this.config.rules.consents[kind]
      ? { allowed: true }
      : { allowed: false, reason: `the user has not allowed ticking "${kind}" consents; ask them` };
  }
}
