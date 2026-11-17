import { describe, expect, test } from "bun:test";
import { classifyMail, isAutomatedSender } from "../../src/mail/classify.ts";
import { buildMime } from "../../src/mail/mime.ts";
import { matchJob, syncMail } from "../../src/mail/sync.ts";
import type { MailMessage, MailProvider } from "../../src/mail/types.ts";
import { tempApp } from "../core/helpers.ts";

const kind = (subject: string, text: string, fromAddress = "noreply@ashbyhq.com", fromSelf = false) =>
  classifyMail({ subject, text, fromAddress, fromSelf }).kind;

describe("classifier", () => {
  const cases: [string, string, string, string?][] = [
    [
      "Your application",
      "Thank you for applying to Acme. We have received your application.",
      "confirmation",
    ],
    ["Ihre Bewerbung", "Vielen Dank für Ihre Bewerbung. Wir melden uns.", "confirmation"],
    ["Eingangsbestätigung", "Ihre Bewerbung ist bei uns eingegangen.", "confirmation"],
    [
      "Automatische Eingangsbestätigung",
      "wir haben Ihre Bewerbungsunterlagen erhalten. Durch die Vielzahl der eingehenden Bewerbungen wird die Auswahl etwas Zeit in Anspruch nehmen.",
      "confirmation",
    ],
    [
      "Deine Bewerbung",
      "Danke für deine Bewerbung! Sobald wir uns für einen anderen Kandidaten entscheiden, erhältst du eine Absage.",
      "confirmation",
    ],
    ["Update", "Unfortunately, we have decided to move forward with other candidates.", "rejection"],
    [
      "Application update",
      "We regret to inform you that we will not be moving forward with your application.",
      "rejection",
    ],
    [
      "Ihre Bewerbung",
      "Leider müssen wir Ihnen mitteilen, dass wir Ihre Bewerbung nicht berücksichtigen können.",
      "rejection",
    ],
    ["Absage", "Wir haben uns für einen anderen Bewerber entschieden.", "rejection"],
    ["Your application", "The position has been filled.", "rejection"],
    [
      "Interview",
      "Ich würde gerne einen ersten Call vereinbaren: https://calendly.com/x/30min",
      "interview",
      "max@acme.com",
    ],
    [
      "Next steps",
      "We would love to chat. Please book a time: https://cal.com/acme",
      "interview",
      "jane@acme.com",
    ],
    [
      "Einladung",
      "Wir möchten Sie gerne zu einem Vorstellungsgespräch einladen.",
      "interview",
      "hr.mueller@acme.de",
    ],
    ["Our offer", "We are pleased to offer you the position.", "offer", "ceo@acme.com"],
    ["Unser Angebot", "Unser Angebot für die Rolle findest du anbei.", "offer", "lead@acme.de"],
    ["Next step", "Please complete the coding challenge on HackerRank within 5 days.", "action"],
    [
      "Fehlende Unterlagen",
      "Allerdings fehlen uns noch ein paar Unterlagen, damit wir weitermachen können.",
      "action",
    ],
    [
      "Bewerbung",
      "Um deine Bewerbung zu verarbeiten, bitten wir dich, der Datenschutzerklärung zuzustimmen.",
      "action",
    ],
    ["Re: Bewerbung", "Hi, danke für die Infos. Hast du nächste Woche Zeit?", "reply", "anna@acme.de"],
    ["Bewerbung", "Wir prüfen Ihre Unterlagen.", "other", "karriere@acme.de"],
    ["Bewerbung", "Wir prüfen Ihre Unterlagen.", "other", "personal@acme.de"],
    ["Application", "Any update?", "other", "bewerbung@acme.de"],
  ];
  for (const [subject, text, expected, from] of cases) {
    test(`${expected}: ${text.slice(0, 50)}`, () => {
      expect(kind(subject, text, from)).toBe(expected as ReturnType<typeof kind>);
    });
  }

  test("the user's own sent mail is never a reply", () => {
    expect(kind("Bewerbung als PM", "Hallo, anbei meine Unterlagen.", "me@example.com", true)).toBe("other");
  });
  test("ATS domains and role mailboxes are automated", () => {
    expect(isAutomatedSender("noreply@hire.lever.co")).toBe(true);
    expect(isAutomatedSender("karriere@example-gmbh.de")).toBe(true);
    expect(isAutomatedSender("jana.berg@example-saas.com")).toBe(false);
  });
});

const msg = (over: Partial<MailMessage>): MailMessage => ({
  id: crypto.randomUUID(),
  receivedAt: "2026-11-10T10:00:00.000Z",
  fromAddress: "noreply@ashbyhq.com",
  fromName: "Acme",
  subject: "Your application at Acme",
  text: "",
  fromSelf: false,
  ...over,
});

describe("sync", () => {
  test("links mail to applied jobs, moves statuses, ignores own mail and is idempotent", async () => {
    const app = tempApp();
    const [id] = app.repo.insertJobs([
      { title: "Product Manager", company: "Acme GmbH", url: "https://acme.example/1", source: "test" },
    ]) as [number];
    app.repo.setStatus(id, "drafted", "agent");
    app.repo.setStatus(id, "applied", "agent");

    const inbox = [
      msg({ text: "Thank you for applying. We have received your application." }),
      msg({
        subject: "Bewerbung bei Acme",
        text: "Hallo, anbei meine Unterlagen. Bewerbung als PM.",
        fromSelf: true,
      }),
      msg({
        receivedAt: "2026-11-12T10:00:00.000Z",
        fromAddress: "lisa@acme.com",
        text: "Hi! I'd love to chat about your application: https://calendly.com/acme/intro",
      }),
    ];
    const provider: MailProvider = { id: "imap", listMessages: async () => inbox, close: async () => {} };

    const first = await syncMail(app, provider);
    expect(first.stored).toBe(2);
    expect(first.statusChanges).toEqual([{ jobId: id, from: "applied", to: "interview" }]);
    expect(app.repo.getJob(id)?.status).toBe("interview");

    const second = await syncMail(app, provider);
    expect(second.stored).toBe(0);
    app.close();
  });

  test("matches by company name in sender or subject", () => {
    const jobs = [{ id: 1, company: "Hollerith Software Group", title: "Product Owner" }] as never;
    expect(matchJob(msg({ fromName: "Hollerith Software Group", subject: "Bewerbung" }), jobs)).not.toBeNull();
    expect(matchJob(msg({ fromName: "Other", subject: "Hello" }), jobs)).toBeNull();
  });

  test("builds a valid MIME draft with attachment", () => {
    const mime = buildMime(
      { to: "jobs@acme.com", subject: "Bewerbung – Produkt", body: "Hallo", attachments: [] },
      "me@example.com",
    );
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("multipart/mixed");
  });
});
