// Onboarding Orchestrator: PURE deterministic logic (no DB, no server imports).
// Imported by the API routes, the client page (live re-validation on edit) and
// scripts/test-onboarding.ts. The LLM is never trusted on money: this file owns
// the checks, the recurring billing schedule and the invoice amounts.

export const DEMO_TODAY = "2026-10-02"; // demo "today"; always passed in as a parameter

export type DealType = "one_time" | "recurring";
export type DealLite = {
  deal_type: DealType;
  amount: number; // total for one_time; monthly for recurring
  term_months: number | null;
  close_date: string; // one_time: project end; recurring: first billing date
};
export type Milestone = { name: string; pct: number; due_date: string };
export type PlannedInvoice = {
  milestone: string;
  amount: number;
  raised_on: string;
  variable_pay_at_stake: number;
};

export const VARIABLE_PAY_RATE = 0.05; // invented rule (HANDOFF §6)
const PCT_TOLERANCE = 0.01;

// ---------- dates (UTC, ISO YYYY-MM-DD) ----------

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Add n calendar months, clamping the day to the target month's end (31 Jan + 1 = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------- money ----------

export function dealTotal(deal: DealLite): number {
  return deal.deal_type === "recurring" ? deal.amount * (deal.term_months ?? 0) : deal.amount;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Milestones -> invoice rows. amount = round(total x pct/100); the rounding
 * remainder goes on the LAST milestone so invoices sum exactly to the deal total.
 */
export function planInvoices(deal: DealLite, milestones: Milestone[]): PlannedInvoice[] {
  const total = Math.round(dealTotal(deal));
  // Recurring: each month bills the contracted monthly amount (pct is the
  // displayed share, already rounded to 2dp, so deriving money from it would
  // give 49,980 / 50,220 instead of 12 x 50,000).
  const recurring = deal.deal_type === "recurring";
  let allocated = 0;
  return milestones.map((m, i) => {
    const isLast = i === milestones.length - 1;
    const share = recurring ? Math.round(deal.amount) : Math.round((total * m.pct) / 100);
    const amount = isLast ? total - allocated : share;
    allocated += amount;
    return {
      milestone: m.name.trim(),
      amount,
      raised_on: m.due_date,
      variable_pay_at_stake: Math.round(amount * VARIABLE_PAY_RATE),
    };
  });
}

// ---------- schedules / templates ----------

/**
 * Recurring deals: code GENERATES the billing schedule (term_months entries,
 * monthly from the first billing date, equal pct). The AI only drafts language.
 * "AI drafts language, code owns money schedule": a monthly schedule is pure
 * arithmetic, so asking an LLM for it only adds ways to be wrong (skipped
 * months, pct drift, wrong count) with no upside.
 */
export function recurringSchedule(deal: DealLite): Milestone[] {
  const n = deal.term_months ?? 0;
  if (n <= 0) return [];
  const base = Math.floor((10000 / n)) / 100; // 2-dp pct, remainder on the last
  return Array.from({ length: n }, (_, i) => {
    const due = addMonths(deal.close_date, i);
    return {
      name: `Month ${i + 1} - ${monthLabel(due)}`,
      pct: i === n - 1 ? round2(100 - base * (n - 1)) : base,
      due_date: due,
    };
  });
}

/** Manual-entry starting point for one_time deals (labelled as a template in the UI, never as AI output). */
export function oneTimeTemplate(deal: DealLite, today: string): Milestone[] {
  const end = deal.close_date;
  const start = end < today ? end : today;
  const span = Math.max(0, daysBetween(start, end));
  return [
    { name: "Kickoff", pct: 40, due_date: start },
    { name: "UAT sign-off", pct: 40, due_date: addDays(start, Math.round(span * 0.75)) },
    { name: "Go-live", pct: 20, due_date: end },
  ];
}

export function templateMilestones(deal: DealLite, today: string): Milestone[] {
  return deal.deal_type === "recurring" ? recurringSchedule(deal) : oneTimeTemplate(deal, today);
}

// ---------- validator ----------

/**
 * Deterministic checks. Returns human-readable flags; empty array = approvable.
 * Never throws on bad input (milestones may come straight from an edited form).
 */
export function validateMilestones(deal: DealLite, milestones: Milestone[], today: string): string[] {
  const flags: string[] = [];
  if (!Array.isArray(milestones) || milestones.length === 0) return ["No milestones: at least one is required."];

  // Deal-level sanity
  if (!(deal.amount > 0)) flags.push("Deal amount must be greater than 0.");
  if (!isIsoDate(deal.close_date)) flags.push(`Deal close date "${deal.close_date}" is not a valid date.`);
  if (deal.deal_type === "one_time" && isIsoDate(deal.close_date) && deal.close_date < today)
    flags.push(`Project end (${deal.close_date}) is before today (${today}): no future milestone can fit. Check the deal record.`);
  if (deal.deal_type === "recurring" && !(deal.term_months && deal.term_months > 0))
    flags.push("Recurring deal has no term_months.");

  // Names
  const seen = new Set<string>();
  milestones.forEach((m, i) => {
    const name = typeof m.name === "string" ? m.name.trim() : "";
    if (!name) flags.push(`Milestone ${i + 1}: name is empty.`);
    else {
      const key = name.toLowerCase();
      if (seen.has(key)) flags.push(`Duplicate milestone name "${name}" (each becomes a unique invoice).`);
      seen.add(key);
    }
  });

  // Percentages
  let sum = 0;
  milestones.forEach((m, i) => {
    if (typeof m.pct !== "number" || !Number.isFinite(m.pct) || m.pct <= 0)
      flags.push(`Milestone ${i + 1}: pct must be a number greater than 0.`);
    else sum += m.pct;
  });
  if (Math.abs(sum - 100) > PCT_TOLERANCE) flags.push(`Percentages sum to ${round2(sum)}%, must be exactly 100%.`);

  // Dates
  const dates = milestones.map((m) => m.due_date);
  dates.forEach((d, i) => {
    if (!isIsoDate(d)) flags.push(`Milestone ${i + 1}: due date "${d ?? ""}" is not a valid YYYY-MM-DD date.`);
    else if (d < today) flags.push(`Milestone ${i + 1}: due date ${d} is before today (${today}).`);
  });
  for (let i = 1; i < dates.length; i++) {
    if (isIsoDate(dates[i - 1]) && isIsoDate(dates[i]) && dates[i] < dates[i - 1])
      flags.push(`Milestone ${i + 1}: due date ${dates[i]} is before milestone ${i}'s (${dates[i - 1]}); dates must be in order.`);
  }

  if (deal.deal_type === "one_time" && isIsoDate(deal.close_date)) {
    dates.forEach((d, i) => {
      if (isIsoDate(d) && d > deal.close_date)
        flags.push(`Milestone ${i + 1}: due date ${d} is after the project end (${deal.close_date}).`);
    });
  }

  if (deal.deal_type === "recurring" && deal.term_months && isIsoDate(deal.close_date)) {
    const n = deal.term_months;
    if (milestones.length !== n)
      flags.push(`Recurring deal needs exactly ${n} monthly milestones (term_months), got ${milestones.length}.`);
    const expectedPct = 100 / n;
    milestones.forEach((m, i) => {
      if (typeof m.pct === "number" && Math.abs(m.pct - expectedPct) > PCT_TOLERANCE + 0.005 * n)
        flags.push(`Milestone ${i + 1}: pct ${m.pct}% should be ${round2(expectedPct)}% (equal monthly billing).`);
      const expected = addMonths(deal.close_date, i);
      if (isIsoDate(m.due_date) && m.due_date !== expected)
        flags.push(`Milestone ${i + 1}: due date ${m.due_date} should be ${expected} (monthly from first billing date ${deal.close_date}).`);
    });
  }

  // Money: every invoice must be > 0 (DB check constraint) once rounded.
  if (flags.length === 0) {
    planInvoices(deal, milestones).forEach((inv, i) => {
      if (inv.amount <= 0) flags.push(`Milestone ${i + 1}: computed invoice amount is ₹${inv.amount}; must be > 0.`);
    });
  }

  return flags;
}

// ---------- display ----------

/** INR with Indian digit grouping: 800000 -> ₹8,00,000. Local helper (no shared dependency). */
export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const [int, dec] = Math.abs(Math.round(n * 100) / 100).toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${neg ? "-" : ""}₹${grouped}${dec === "00" ? "" : `.${dec}`}`;
}
