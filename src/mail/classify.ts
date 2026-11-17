// Rule-based classification of job mail (German and English). Deterministic, explainable, testable.
// Order matters: the opening of a mail says what it is; later paragraphs are often process boilerplate.
import type { MailKind } from "./types.ts";

export interface ClassifyInput {
  subject: string;
  text: string;
  fromAddress: string;
  fromSelf?: boolean;
}

export interface Classification {
  kind: MailKind;
  reason: string;
}

/** Senders that are never a human writing back, whatever the wording. */
export const AUTOMATED_SENDER =
  /(no-?reply|do-?not-?reply|notification|mailer|postmaster|^jobs?@|^careers?@|^karriere@|^recruiting@|^recruitment@|^talent@|^bewerbung(en)?@|^personal@|^hr@|^application@|candidate-[^@]*@)/i;

/** Applicant tracking systems that send on behalf of employers. */
export const ATS_DOMAINS =
  /(greenhouse|ashbyhq|lever\.co|workable|personio|recruitee|smartrecruiters|teamtailor|join\.com|bamboohr|myworkday|workday|successfactors|softgarden|onlyfy|jobvite|icims|breezy|pinpoint|homerun|comeet|rippling|dover|concludis|dvinci|d-vinci|rexx|jobylon|coveto|helix|talentlink|avature)/i;

const RX = {
  rejection:
    /(regret to inform|not (to )?(be )?mov(e|ing) forward with (your|you)|decided (not )?to (move|proceed|go) (forward )?with (other|another)|proceed with other candidates|won.?t be progressing|not (be )?progress(ing)? (with )?your application|not been selected|position has been filled|not able to offer you|decided not to (proceed|move)|unfortunately,? (we|after|this time|on this occasion)[^.]{0,80}(not|other|unable)|leider mitteilen|leider (keine|nicht)|(dir|ihnen) leider|uns (leider )?(gegen|für einen? anderen?)|mit anderen kandidat|anderen? (kandidat|bewerber)|nicht (weiter )?berücksichtig|nicht in die engere|keine positive rückmeldung|absage)/i,
  offer:
    /(offer letter|pleased to offer|happy to offer|unser angebot|vertragsangebot|ein (vertrags)?angebot (machen|unterbreiten)|offer details)/i,
  action:
    /((sql|coding|online|technical|technischen?)[- ]?(test|assessment|challenge|aufgabe)|coderbyte|hackerrank|codility|testgorilla|take-?home|case study|fallstudie|probeaufgabe|questionnaire|fragebogen|fehlende unterlagen|fehlen (uns )?noch [^.]{0,30}unterlagen|missing documents|still interested|noch interessiert|setzen sie ihre bewerbung fort|continue your application|bewerbung (zu )?(vervollständigen|abschließen)|complete your application|datenschutzerklärung zu(zu)?stimmen|accept (the|our) privacy)/i,
  invite:
    /(calendly\.com|cal\.com\/|book (a|your) (time|slot|call)|termin (buchen|aussuchen|auswählen)|introductory call|intro call|arrange a (quick |short )?(call|chat)|schedule (a|an|your) (call|interview|chat)|invite you (to|for) (a|an) (call|interview|chat)|would love to (chat|talk|speak)|einladung zu(m|r)? (einem )?(ersten )?(gespräch|interview|kennenlern|video|telefon)|(zu einem|zum) (vorstellungs|kennenlern|telefon|video)?gespräch einladen|möchten (dich|sie) (gerne )?(kennenlernen|einladen)|ersten call vereinbaren)/i,
  confirmation:
    /(danke für (deine|ihre|dein|ihr) bewerbung|vielen dank für (deine|ihre|dein|ihr) (bewerbung|interesse)|received your application|we.?ve received|we have received|application (has been )?received|application was sent|thank(s| you) for (applying|your application|your interest)|wir haben (deine|ihre|dein|ihr) bewerbung|bewerbungsunterlagen erhalten|eingang (ihrer|deiner) bewerbung|eingangsbestätigung|bewerbung (ist )?(bei uns )?eingegangen|application was viewed|bewerbung wurde angesehen)/i,
};

/** A phrase inside a conditional or future sentence ("if we decide for another candidate …") does not count. */
const CONDITIONAL =
  /(sobald|falls|wenn|sollten|ob wir|erhältst du|erhalten sie|wirst du|werden sie|you will receive|you.?ll receive|will (be )?(invited|in touch)|\bif (we|you|your)|once (we|you|your)|as soon as|should (we|your)|in case)/i;

/** The sentence around a regex match. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index)) + 1;
  const rest = text.slice(index).search(/[.\n]/);
  return text.slice(start, rest < 0 ? undefined : index + rest);
}

/** True when `rx` matches in a sentence that is not conditional. Returns the matched phrase. */
function assertiveMatch(rx: RegExp, text: string): string | null {
  const global = new RegExp(rx.source, `${rx.flags.replace("g", "")}g`);
  for (const m of text.matchAll(global)) {
    if (!CONDITIONAL.test(sentenceAround(text, m.index ?? 0))) return m[0];
  }
  return null;
}

/** Is this sender an automated system rather than a person? */
export function isAutomatedSender(address: string): boolean {
  const a = address.toLowerCase();
  return AUTOMATED_SENDER.test(a) || ATS_DOMAINS.test(a.split("@")[1] ?? "");
}

/** Classifies one message. Own mail is never a reply; automated senders are never "reply". */
export function classifyMail(m: ClassifyInput): Classification {
  if (m.fromSelf) return { kind: "other", reason: "sent by the user" };
  const text = `${m.subject}\n${m.text}`;
  const head = text.slice(0, 700);

  const rejection = assertiveMatch(RX.rejection, text.slice(0, 3000));
  if (rejection) return { kind: "rejection", reason: `"${rejection}"` };
  const offer = RX.offer.exec(head);
  if (offer) return { kind: "offer", reason: `"${offer[0]}"` };
  const action = RX.action.exec(head);
  if (action) return { kind: "action", reason: `"${action[0]}"` };
  const invite = assertiveMatch(RX.invite, text.slice(0, 1500));
  if (invite) return { kind: "interview", reason: `"${invite}"` };
  const receipt = RX.confirmation.exec(head);
  if (receipt) return { kind: "confirmation", reason: `"${receipt[0]}"` };
  if (isAutomatedSender(m.fromAddress))
    return { kind: "other", reason: "automated sender, no known pattern" };
  return { kind: "reply", reason: "personal message from a person" };
}

/** Rough filter: is this mail about a job application at all? */
export function looksJobRelated(subject: string, text: string): boolean {
  return /(application|applying|bewerbung|interview|candidate|kandidat|position|stelle|recruit|hiring|vorstellungsgespr|angebot|offer)/i.test(
    `${subject} ${text.slice(0, 1000)}`,
  );
}
