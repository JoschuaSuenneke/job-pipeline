// MCP tools that run integrations: scouting, CV and cover note documents, mail.
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { App } from "../core/app.ts";
import { loadFacts } from "../core/workspace.ts";
import { checkClaims } from "../cv/factcheck.ts";
import { renderCoverHtml, renderCvHtml, toParagraphs, writeDocument } from "../cv/render.ts";
import { buildCv } from "../cv/select.ts";
import { createProvider, syncMail } from "../mail/sync.ts";
import { runScout } from "../sources/scout.ts";
import { fail, ok } from "./result.ts";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function registerWorkTools(server: McpServer, app: App): void {
  server.registerTool(
    "scout",
    {
      description:
        "Fetch new jobs from the enabled sources, store them and run the first-pass screening. Kept jobs stay 'new' for you to triage.",
      inputSchema: { only: z.array(z.string()).optional() },
    },
    async ({ only }) => ok(await runScout(app, { only })),
  );

  server.registerTool(
    "build_cv",
    {
      description:
        "Build a CV for one job from confirmed facts: bullets are picked and ordered by relevance to the job. Renders HTML (and PDF when Playwright is installed) and stores it on the job.",
      inputSchema: {
        id: z.number().int(),
        language: z.string().default("en"),
        maxBullets: z.number().int().min(3).max(30).default(12),
      },
    },
    async ({ id, language, maxBullets }) => {
      const job = app.repo.getJob(id);
      if (!job) return fail(`Job ${id} not found`);
      const cv = buildCv(loadFacts(app.ws), app.config, {
        job: { title: job.title, company: job.company, description: job.description },
        language,
        maxBullets,
      });
      if (cv.experience.length === 0)
        return fail("No confirmed experience facts yet. Run the onboarding first.");
      const base = join(app.ws.outDir, `${id}-${slug(job.company)}`, `cv-${language}`);
      const file = await writeDocument(renderCvHtml(cv, app.config.documents.cvTemplate), base);
      const outline = cv.experience
        .map((e) => `${e.title}, ${e.organisation}\n${e.bullets.map((b) => `- ${b.text}`).join("\n")}`)
        .join("\n\n");
      app.repo.saveDocument({
        jobId: id,
        kind: "cv",
        language,
        body: outline,
        factIds: cv.factIds,
        path: file.pdfPath ?? file.htmlPath,
      });
      return ok({ ...file, notes: cv.notes, factIds: cv.factIds });
    },
  );

  server.registerTool(
    "save_cover_note",
    {
      description:
        "Fact-check and store a cover note you wrote for a job, then render it. Rejected when the check finds unsupported numbers, tools, employers, em dashes or too many words: fix the text or ask the user to confirm a new fact.",
      inputSchema: {
        id: z.number().int(),
        text: z.string().min(40),
        language: z.string().default("en"),
        subject: z.string().optional(),
        recipient: z.string().optional(),
        /** Fact ids the text relies on. */
        factIds: z.array(z.string()).default([]),
      },
    },
    async ({ id, text, language, subject, recipient, factIds }) => {
      const job = app.repo.getJob(id);
      if (!job) return fail(`Job ${id} not found`);
      const check = checkClaims(text, loadFacts(app.ws), {
        maxWords: app.config.documents.coverLetterMaxWords,
        context: `${job.company} ${job.title} ${job.description} ${app.config.compensation.ask}`,
        allow: [app.config.candidate.name, app.config.candidate.home],
      });
      if (!check.ok) return fail(JSON.stringify({ message: "Fact check failed", issues: check.issues }));
      const { candidate } = app.config;
      const html = renderCoverHtml({
        language,
        senderName: candidate.name,
        senderContact: [candidate.email, candidate.phone ?? "", candidate.home].filter(Boolean),
        recipient: recipient ?? job.company,
        subject,
        date: new Date().toLocaleDateString(language),
        paragraphs: toParagraphs(text),
      });
      const file = await writeDocument(
        html,
        join(app.ws.outDir, `${id}-${slug(job.company)}`, `cover-${language}`),
      );
      app.repo.saveDocument({
        jobId: id,
        kind: "cover_note",
        language,
        body: text,
        factIds,
        path: file.pdfPath ?? file.htmlPath,
      });
      if (job.status === "new")
        app.repo.setStatus(id, "drafted", "agent", "CV and cover note ready for review");
      return ok({ ...file, words: check.words });
    },
  );

  server.registerTool(
    "check_text",
    {
      description: "Fact-check any text (form answer, message) against confirmed facts without saving it.",
      inputSchema: {
        text: z.string(),
        jobId: z.number().int().optional(),
        maxWords: z.number().int().optional(),
      },
    },
    async ({ text, jobId, maxWords }) => {
      const job = jobId ? app.repo.getJob(jobId) : null;
      return ok(
        checkClaims(text, loadFacts(app.ws), {
          maxWords,
          context: job ? `${job.company} ${job.title} ${job.description}` : "",
          allow: [app.config.candidate.name, app.config.candidate.home],
        }),
      );
    },
  );

  server.registerTool(
    "save_answers",
    {
      description:
        "Store the answers you prepared for a job's application form (question → answer), after check_text.",
      inputSchema: { id: z.number().int(), answers: z.record(z.string(), z.string()) },
    },
    async ({ id, answers }) => {
      if (!app.repo.getJob(id)) return fail(`Job ${id} not found`);
      const body = Object.entries(answers)
        .map(([q, a]) => `${q}\n${a}`)
        .join("\n\n");
      return ok({
        documentId: app.repo.saveDocument({ jobId: id, kind: "answers", language: "", body, factIds: [] }),
      });
    },
  );

  server.registerTool(
    "sync_mail",
    {
      description:
        "Read new mail, link it to jobs and update statuses (rejections, interview invites, offers).",
    },
    async () => {
      try {
        const provider = createProvider(app);
        if (!provider) return fail("Mail is not connected. The user can run `job-pipeline mail setup`.");
        try {
          return ok(await syncMail(app, provider));
        } finally {
          await provider.close();
        }
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "create_email_draft",
    {
      description:
        "For jobs that apply by email: put the application into the user's Drafts folder with the job's CV and cover note attached. Needs the user's go for this job (record_approval). Never sends.",
      inputSchema: {
        id: z.number().int(),
        to: z.email().optional(),
        subject: z.string().min(5),
        body: z.string().min(40),
      },
    },
    async ({ id, to, subject, body }) => {
      const job = app.repo.getJob(id);
      if (!job) return fail(`Job ${id} not found`);
      const allowed = app.policy.createEmailDraft();
      if (!allowed.allowed) return fail(allowed.reason);
      if (job.status !== "approved")
        return fail("Record the user's go for this job first (record_approval).");
      const recipient = to ?? job.apply_email;
      if (!recipient) return fail("No recipient: pass `to` or store the job's apply email.");
      const attachments = ["cv", "cover_note"]
        .map((kind) => app.repo.latestDocument(id, kind)?.path)
        .filter((p): p is string => Boolean(p?.endsWith(".pdf")))
        .map((path) => ({ filename: path.split("/").pop() as string, path }));
      const provider = createProvider(app);
      if (!provider?.createDraft)
        return fail("The connected mailbox cannot create drafts, or no mailbox is connected.");
      try {
        const draft = await provider.createDraft({ to: recipient, subject, body, attachments });
        app.repo.logEvent({
          jobId: id,
          actor: "agent",
          kind: "email_draft",
          note: `to ${recipient}: ${subject}`,
        });
        return ok({ draftId: draft.id, to: recipient, attachments: attachments.map((a) => a.filename) });
      } finally {
        await provider.close();
      }
    },
  );

  server.registerTool(
    "list_mail",
    {
      description: "Job-related mail already synced, newest first.",
      inputSchema: { limit: z.number().int().max(500).default(50) },
    },
    async ({ limit }) => ok(app.repo.listMail(limit)),
  );
}
