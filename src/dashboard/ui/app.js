// Job Pipeline dashboard. Vanilla ES module, no build step. All text goes through textContent (no innerHTML).

const STATUSES = [
  "new",
  "drafted",
  "approved",
  "applied",
  "conversation",
  "interview",
  "offer",
  "accepted",
  "rejected",
  "parked",
  "dropped",
];
const LABEL = {
  new: "To triage",
  drafted: "Ready for review",
  approved: "Approved",
  applied: "Applied",
  conversation: "Conversation",
  interview: "Interview",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  parked: "Parked",
  dropped: "Dropped",
};
const TONE = {
  interview: "ok",
  offer: "ok",
  accepted: "ok",
  conversation: "ok",
  rejected: "bad",
  dropped: "bad",
  approved: "warn",
};
const HOT_MAIL = new Set(["interview", "offer", "action"]);

const state = {
  view: "pipeline",
  status: "drafted",
  q: "",
  sort: { key: "fit_score", dir: -1 },
  summary: null,
};
const $main = document.getElementById("main");
const $drawer = document.getElementById("drawer");
const $toast = document.getElementById("toast");

/** Creates an element: h("button", { class: "btn", onclick }, "Text", child). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, init) {
  const res = await fetch(path, init && { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { issues: body.issues ?? [] });
  return body;
}
const post = (path, data, method = "POST") => api(path, { method, body: JSON.stringify(data) });

function toast(message) {
  $toast.textContent = message;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2600);
}

const fmtDate = (s) =>
  s
    ? new Date(`${s.replace(" ", "T")}${s.includes("Z") || s.includes("+") ? "" : "Z"}`).toLocaleString()
    : "";
function money(j) {
  if (!j.salary_max) return "";
  let fmt = (n) => Math.round(n).toLocaleString();
  try {
    const f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: j.currency,
      notation: "compact",
    });
    fmt = (n) => f.format(n);
  } catch {
    // no or unknown currency code
  }
  const min = j.salary_min ?? j.salary_max;
  return min === j.salary_max ? fmt(min) : `${fmt(min)}–${fmt(j.salary_max)}`;
}
const pill = (status) => h("span", { class: `pill ${TONE[status] ?? ""}` }, LABEL[status] ?? status);

// \u2500\u2500\u2500 Pipeline \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  review: "M4 5h16v11H8l-4 4z",
  send: "M3 11l18-8-8 18-2-8z",
  reply: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
  chat: "M21 12a8 8 0 01-11.8 7L3 21l2-6.2A8 8 0 1121 12z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  award: "M12 15a6 6 0 100-12 6 6 0 000 12zM8.5 14L7 22l5-3 5 3-1.5-8",
};
/** Inline stroke icon (decorative). */
function icon(name) {
  const el = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    el.setAttribute(k, String(v));
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", ICONS[name]);
  el.append(p);
  return el;
}

const DOT = {
  new: "stone",
  drafted: "coral",
  approved: "butter",
  applied: "sky",
  conversation: "butter",
  interview: "lav",
  offer: "mint",
  accepted: "mint",
  rejected: "pink",
  parked: "stone",
  dropped: "stone",
};
const AVATAR_TONES = ["#a5583f", "#5b7a5e", "#4f6d8a", "#7a5c8f", "#8a6d3b", "#3f7a78", "#8a4f5c"];

const pct = (n) => (n === null || n === undefined ? "\u2013" : `${Math.round(n * 100)}%`);
const initials = (name) =>
  name
    .replace(/\b(gmbh|ag|inc|ltd|llc)\b\.?/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
const toneFor = (name) =>
  AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

/** "3h ago", "4d ago" from an SQLite UTC timestamp. */
function ago(ts) {
  const then = new Date(`${ts.replace(" ", "T")}Z`).getTime();
  const min = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

function kpi(tone, iconName, label, value, sub) {
  return h(
    "div",
    { class: `kpi ${tone}` },
    h("div", { class: "kpi-head" }, icon(iconName), h("span", {}, label)),
    h("b", {}, value),
    h("small", {}, sub),
  );
}

async function renderPipeline() {
  const summary = await api("/api/summary");
  state.summary = summary;
  const c = summary.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total === 0) return $main.replaceChildren(emptyState());

  const n = (...keys) => keys.reduce((sum, k) => sum + (c[k] ?? 0), 0);
  const applied = n("applied", "conversation", "interview", "offer", "accepted", "rejected");
  const interviews = n("interview", "offer", "accepted");
  const week = summary.appliedPerDay.slice(-7).reduce((a, d) => a + d.n, 0);
  const stats = h(
    "div",
    { class: "kpis" },
    kpi("coral", "review", "To review", n("drafted"), `${n("new")} to triage`),
    kpi("butter", "send", "Applied", applied, `+${week} this week`),
    kpi(
      "pink",
      "reply",
      "Response rate",
      pct(summary.responseRate),
      `${n("conversation", "interview", "offer", "accepted", "rejected")} replies · ${n("rejected")} rejected`,
    ),
    kpi(
      "lav",
      "chat",
      "In conversation",
      n("conversation"),
      `${applied ? Math.round((n("conversation") / applied) * 100) : 0}% of applied`,
    ),
    kpi(
      "sky",
      "calendar",
      "Interview rate",
      applied ? pct(interviews / applied) : "\u2013",
      `${interviews} interviews`,
    ),
    kpi(
      "mint",
      "award",
      "Offers",
      n("offer", "accepted"),
      interviews
        ? `${Math.round((n("offer", "accepted") / interviews) * 100)}% of interviews`
        : "no interviews yet",
    ),
  );

  const tabs = h(
    "div",
    { class: "seg", role: "tablist", "aria-label": "Status" },
    STATUSES.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          class: `seg-tab${state.status === s ? " on" : ""}`,
          "aria-selected": String(state.status === s),
          onclick: () => {
            state.status = s;
            renderPipeline();
          },
        },
        h("span", { class: `dot ${DOT[s]}` }),
        LABEL[s],
        h("span", { class: `count${s === "drafted" && c[s] ? " hot" : ""}` }, c[s] ?? 0),
      ),
    ),
  );
  const search = h("input", {
    type: "search",
    placeholder: "Search",
    "aria-label": "Search jobs",
    value: state.q,
    oninput: (e) => {
      state.q = e.target.value;
      loadJobs(tableHost);
    },
  });
  const tableHost = h("div", { class: "sheet-body" });
  const sheet = h(
    "section",
    { class: "sheet" },
    h("div", { class: "sheet-head" }, tabs),
    h("div", { class: "sheet-bar" }, h("p", { class: "hint" }, HINT[state.status] ?? ""), search),
    tableHost,
  );
  $main.replaceChildren(stats, sheet);
  await loadJobs(tableHost);
}

const HINT = {
  new: "Found and screened by the rules. Your agent reads each one before it moves on.",
  drafted: "CV and cover note ready. Waiting for your go.",
  approved: "You said go. Your agent may submit these, once each.",
  applied: "Submitted. Replies are matched from your inbox.",
  conversation: "A person at the company wrote back.",
  interview: "Interviews scheduled or done.",
  offer: "Offers on the table.",
  rejected: "Closed by the employer.",
  parked: "Kept for later: senior titles, second roles at a company.",
  dropped: "Screened out, with the reason in each job's history.",
};

async function loadJobs(host) {
  const params = new URLSearchParams({ status: state.status });
  if (state.q) params.set("q", state.q);
  const jobs = await api(`/api/jobs?${params}`);
  const { key, dir } = state.sort;
  jobs.sort((a, b) => ((a[key] ?? -1) > (b[key] ?? -1) ? dir : -dir));
  if (!jobs.length) return host.replaceChildren(h("p", { class: "empty-row" }, "Nothing here yet."));
  const sortTh = (k, label, cls = "") =>
    h(
      "th",
      { class: cls },
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
            loadJobs(host);
          },
        },
        label,
        state.sort.key === k ? (state.sort.dir < 0 ? " \u2193" : " \u2191") : "",
      ),
    );
  host.replaceChildren(
    h(
      "table",
      {},
      h(
        "colgroup",
        {},
        h("col", {}),
        h("col", { class: "c-loc" }),
        h("col", { class: "c-pay" }),
        h("col", { class: "c-fit" }),
        h("col", { class: "c-upd" }),
      ),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          sortTh("title", "Role"),
          h("th", { class: "col-opt" }, "Location"),
          h("th", { class: "col-opt" }, "Salary"),
          sortTh("fit_score", "Fit"),
          sortTh("updated_at", "Updated", "col-opt"),
        ),
      ),
      h(
        "tbody",
        {},
        jobs.map((j) =>
          h(
            "tr",
            { onclick: () => openJob(j.id) },
            h(
              "td",
              {},
              h(
                "div",
                { class: "co" },
                h(
                  "span",
                  { class: "avatar", style: `background:${toneFor(j.company)}`, "aria-hidden": "true" },
                  initials(j.company),
                ),
                h(
                  "div",
                  { class: "co-text" },
                  h("button", { type: "button", class: "row-link" }, j.title),
                  h("span", { class: "co-sub" }, j.company),
                ),
              ),
            ),
            h(
              "td",
              { class: "col-opt m" },
              j.work_mode !== "unknown" ? h("span", { class: "mode" }, j.work_mode) : null,
              j.location,
            ),
            h("td", { class: "col-opt m" }, money(j) || "\u2014"),
            h(
              "td",
              {},
              j.fit_score === null
                ? "\u2013"
                : h(
                    "span",
                    { class: "fit" },
                    j.fit_score,
                    h("span", { class: "bar" }, h("i", { style: `width:${j.fit_score}%` })),
                  ),
            ),
            h("td", { class: "col-opt" }, h("span", { class: "date" }, ago(j.updated_at))),
          ),
        ),
      ),
    ),
  );
}

function emptyState() {
  return h(
    "div",
    { class: "empty" },
    h("h1", {}, "Your pipeline is empty"),
    h(
      "p",
      { class: "muted" },
      "Run the first scout, or open your agent in the workspace and say ",
      h("code", {}, "onboard me"),
      ".",
    ),
    h("p", {}, h("code", {}, "job-pipeline scout")),
  );
}

// ─── Job drawer ─────────────────────────────────────────────────────────────
async function openJob(id) {
  const { job, documents, events, next } = await api(`/api/jobs/${id}`);
  const reasons = JSON.parse(job.fit_reasons || "[]");
  const err = h("p", { class: "error", role: "alert" });
  const wording = h("input", {
    type: "text",
    id: "approve-words",
    placeholder: 'e.g. "Go, send it with the product CV"',
  });
  const note = h("input", { type: "text", id: "status-note", placeholder: "Reason (optional)" });

  const act = async (fn, done) => {
    err.textContent = "";
    try {
      await fn();
      toast(done);
      $drawer.close();
      render();
    } catch (e) {
      err.textContent = [e.message, ...e.issues.map((i) => i.message)].join(" · ");
    }
  };

  const canApprove = ["drafted", "approved"].includes(job.status);
  $drawer.replaceChildren(
    h(
      "div",
      { class: "drawer-inner" },
      h(
        "div",
        { class: "drawer-head" },
        h(
          "div",
          {},
          h("h1", { id: "drawer-title" }, job.title),
          h("div", { class: "muted" }, `${job.company} · ${job.location}`),
          pill(job.status),
        ),
        h(
          "button",
          { type: "button", class: "btn", onclick: () => $drawer.close(), "aria-label": "Close" },
          "Close",
        ),
      ),
      h(
        "p",
        {},
        h("a", { href: job.url, target: "_blank", rel: "noreferrer noopener" }, "Open posting"),
        job.fit_score !== null ? ` · fit ${job.fit_score}` : "",
        reasons.length ? ` · ${reasons.join(", ")}` : "",
      ),
      canApprove &&
        h(
          "section",
          {},
          h("h2", {}, "Your go"),
          h(
            "p",
            { class: "muted" },
            "Approving lets your agent submit this one application. Your words are stored with the approval.",
          ),
          h(
            "div",
            { class: "actions" },
            h("div", { class: "field" }, h("label", { for: "approve-words" }, "In your own words"), wording),
            h(
              "button",
              {
                type: "button",
                class: "btn primary",
                onclick: () =>
                  act(() => post(`/api/jobs/${id}/approve`, { wording: wording.value }), "Approved"),
              },
              "Approve",
            ),
          ),
        ),
      next.length > 0 &&
        h(
          "section",
          {},
          h("h2", {}, "Change status"),
          h(
            "div",
            { class: "actions" },
            h("div", { class: "field" }, h("label", { for: "status-note" }, "Note"), note),
            next.map((to) =>
              h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onclick: () =>
                    act(
                      () => post(`/api/jobs/${id}/status`, { to, note: note.value }),
                      `Moved to ${LABEL[to]}`,
                    ),
                },
                LABEL[to],
              ),
            ),
          ),
          err,
        ),
      documents.coverNote &&
        h("section", {}, h("h2", {}, "Cover note"), h("div", { class: "doc" }, documents.coverNote.body)),
      documents.cv &&
        h(
          "section",
          {},
          h("h2", {}, "CV"),
          documents.cv.path ? h("p", { class: "mono" }, documents.cv.path) : null,
          h("div", { class: "doc" }, documents.cv.body),
        ),
      documents.answers &&
        h("section", {}, h("h2", {}, "Form answers"), h("div", { class: "doc" }, documents.answers.body)),
      h(
        "section",
        {},
        h("h2", {}, "Description"),
        h("div", { class: "desc" }, job.description || "No description stored."),
      ),
      h("section", {}, h("h2", {}, "History"), timeline(events)),
    ),
  );
  $drawer.showModal();
}

function timeline(events) {
  return h(
    "ol",
    { class: "timeline" },
    events.map((e) =>
      h(
        "li",
        {},
        h("time", { datetime: e.at }, fmtDate(e.at)),
        h(
          "span",
          {},
          `${e.actor} · ${e.kind}${e.to_status ? ` → ${LABEL[e.to_status] ?? e.to_status}` : ""}${e.note ? `: ${e.note}` : ""}`,
        ),
      ),
    ),
  );
}

// ─── Inbox, activity ────────────────────────────────────────────────────────
async function renderInbox() {
  const mail = await api("/api/mail");
  if (!mail.length)
    return $main.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h1", {}, "No job mail yet"),
        h(
          "p",
          { class: "muted" },
          "Connect a mailbox with ",
          h("code", {}, "job-pipeline mail setup"),
          ", then run ",
          h("code", {}, "job-pipeline mail sync"),
          ".",
        ),
      ),
    );
  $main.replaceChildren(
    h("h1", {}, "Inbox"),
    h(
      "div",
      { class: "mail-list" },
      mail.map((m) =>
        h(
          "article",
          { class: `mail ${HOT_MAIL.has(m.kind) ? "hot" : ""}` },
          h(
            "span",
            {},
            h(
              "span",
              { class: `pill ${m.kind === "rejection" ? "bad" : HOT_MAIL.has(m.kind) ? "warn" : ""}` },
              m.kind,
            ),
          ),
          h(
            "div",
            {},
            h("div", { class: "subj" }, m.subject),
            h("div", { class: "muted" }, `${m.from_name || m.from_addr} · ${m.reason}`),
          ),
          h("time", { class: "muted", datetime: m.received_at }, fmtDate(m.received_at)),
        ),
      ),
    ),
  );
}

async function renderActivity() {
  $main.replaceChildren(h("h1", {}, "Activity"), timeline(await api("/api/events?limit=300")));
}

// ─── Settings ───────────────────────────────────────────────────────────────
const list = (v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function renderSettings() {
  const cfg = await api("/api/config");
  const err = h("div", { class: "error", role: "alert" });
  const f = (id, label, value, type = "text") =>
    h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, type, value }));
  const check = (id, label, checked) =>
    h("label", { class: "check" }, h("input", { id, type: "checkbox", checked }), label);

  const tiers = h("div", { class: "tier-list", style: "display:contents" });
  const addTier = (t = { label: "", places: [], maxOfficeDays: 2 }) =>
    tiers.append(
      h(
        "div",
        { class: "tier" },
        h(
          "div",
          { class: "field" },
          h("label", {}, "Tier"),
          h("input", { type: "text", value: t.label, "data-k": "label", "aria-label": "Tier name" }),
        ),
        h(
          "div",
          { class: "field" },
          h("label", {}, "Places (comma separated)"),
          h("input", {
            type: "text",
            value: t.places.join(", "),
            "data-k": "places",
            "aria-label": "Places",
          }),
        ),
        h(
          "div",
          { class: "field" },
          h("label", {}, "Office days/week"),
          h("input", {
            type: "number",
            min: 0,
            max: 5,
            value: t.maxOfficeDays,
            "data-k": "days",
            "aria-label": "Maximum office days per week",
          }),
        ),
        h(
          "button",
          { type: "button", class: "btn", onclick: (e) => e.target.closest(".tier").remove() },
          "Remove",
        ),
      ),
    );
  for (const t of cfg.location.tiers) addTier(t);

  const c = cfg.rules.consents;
  const form = h(
    "form",
    {
      class: "settings",
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    h("h1", {}, "Settings"),
    h(
      "fieldset",
      {},
      h("legend", {}, "Targets"),
      f("roles", "Roles (comma separated)", cfg.targets.roles.join(", ")),
      f("keywords", "Extra keywords", cfg.targets.keywords.join(", ")),
      f("maxYears", "Max. years required", cfg.targets.maxYearsRequired, "number"),
      f("exclude", "Exclude title patterns (regex)", cfg.targets.excludeTitlePatterns.join(", ")),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Location"),
      f("remote", "Remote allowed from (countries)", cfg.location.remoteCountries.join(", ")),
      tiers,
      h("button", { type: "button", class: "btn", onclick: () => addTier() }, "Add commute tier"),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Compensation"),
      f("floor", `Floor (${cfg.compensation.currency})`, cfg.compensation.floor, "number"),
      f("ask", `Ask (${cfg.compensation.currency})`, cfg.compensation.ask, "number"),
      check("fixed", "Prefer fixed salary over OTE", cfg.compensation.preferFixed),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Rules"),
      f("blocklist", "Blocklist (companies or groups)", cfg.rules.blocklist.join(", ")),
      f("limit", "Applications per day", cfg.rules.dailyApplicationLimit, "number"),
      check("drafts", "Agent may put application emails into my Drafts (never sends)", cfg.rules.emailDrafts),
      check("oneRole", "One role per company", cfg.rules.oneRolePerCompany),
      h(
        "p",
        { class: "muted", style: "grid-column:1/-1;margin:0" },
        "Consent boxes your agent may tick (only when true for you):",
      ),
      check("cPrivacy", "Privacy policy", c.privacy),
      check("cPool", "Talent pool", c.talentPool),
      check("cTerms", "Portal terms of use", c.termsOfUse),
      check("cBackground", "Background check", c.backgroundCheck),
      check("cRecording", "Interview recording", c.recording),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Mail"),
      h(
        "p",
        { style: "margin:0" },
        `Provider: ${cfg.mail.provider}. Change with `,
        h("code", {}, "job-pipeline mail setup"),
        ".",
      ),
      check("filing", `File confirmations into "${cfg.mail.folder}"`, cfg.mail.fileConfirmations),
    ),
    err,
    h("div", {}, h("button", { type: "submit", class: "btn primary" }, "Save settings")),
  );
  $main.replaceChildren(form);

  const v = (id) => form.querySelector(`#${id}`);
  async function save() {
    const next = structuredClone(cfg);
    next.targets.roles = list(v("roles").value);
    next.targets.keywords = list(v("keywords").value);
    next.targets.maxYearsRequired = Number(v("maxYears").value);
    next.targets.excludeTitlePatterns = list(v("exclude").value);
    next.location.remoteCountries = list(v("remote").value);
    next.location.tiers = [...tiers.querySelectorAll(".tier")].map((row) => ({
      label: row.querySelector('[data-k="label"]').value.trim(),
      places: list(row.querySelector('[data-k="places"]').value),
      maxOfficeDays: Number(row.querySelector('[data-k="days"]').value),
    }));
    next.compensation.floor = Number(v("floor").value);
    next.compensation.ask = Number(v("ask").value);
    next.compensation.preferFixed = v("fixed").checked;
    next.rules.blocklist = list(v("blocklist").value);
    next.rules.dailyApplicationLimit = Number(v("limit").value);
    next.rules.emailDrafts = v("drafts").checked;
    next.rules.oneRolePerCompany = v("oneRole").checked;
    next.rules.consents = {
      privacy: v("cPrivacy").checked,
      talentPool: v("cPool").checked,
      termsOfUse: v("cTerms").checked,
      backgroundCheck: v("cBackground").checked,
      recording: v("cRecording").checked,
    };
    next.mail.fileConfirmations = v("filing").checked;
    err.textContent = "";
    try {
      await post("/api/config", next, "PUT");
      toast("Settings saved");
    } catch (e) {
      err.textContent = [e.message, ...e.issues.map((i) => `${i.path}: ${i.message}`)].join(" · ");
    }
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────
const VIEWS = {
  pipeline: renderPipeline,
  inbox: renderInbox,
  activity: renderActivity,
  settings: renderSettings,
};

async function render() {
  for (const b of document.querySelectorAll("[data-view]")) {
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  try {
    await VIEWS[state.view]();
    if (state.summary) {
      document.getElementById("who").textContent = state.summary.candidate;
      document.getElementById("mark").textContent = initials(state.summary.candidate);
    }
  } catch (e) {
    $main.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h1", {}, "Something went wrong"),
        h("p", { class: "error" }, e.message),
      ),
    );
  }
}

for (const b of document.querySelectorAll("[data-view]")) {
  b.addEventListener("click", () => {
    state.view = b.dataset.view;
    render();
    $main.focus();
  });
}
render();
