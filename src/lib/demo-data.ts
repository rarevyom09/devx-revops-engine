// Invented demo dataset. Fixed UUIDs make "Load demo data" idempotent (upsert).
// Demo "today" is 2026-10-02 (start of Q4 2026, calendar quarters assumed).

const id = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const P = {
  priya: id("11111111", 1),
  daniel: id("11111111", 2),
  arjun: id("11111111", 3),
  meilin: id("11111111", 4),
  rahul: id("11111111", 5),
};

export const people = [
  { id: P.priya, name: "Priya Sharma", role: "consulting_owner", entity: "IN", variable_pay_target: 400000 },
  { id: P.daniel, name: "Daniel Tan", role: "consulting_owner", entity: "SG", variable_pay_target: 600000 },
  { id: P.arjun, name: "Arjun Mehta", role: "practice_lead", entity: "IN", variable_pay_target: 250000 },
  { id: P.meilin, name: "Mei Lin Koh", role: "practice_lead", entity: "SG", variable_pay_target: 350000 },
  { id: P.rahul, name: "Rahul Verma", role: "delivery", entity: "IN", variable_pay_target: null },
];

export const rates = [
  { location: "IN", hourly_rate: 2000, currency: "INR" },
  { location: "SG", hourly_rate: 6500, currency: "INR" },
];

// Pending deals for the Pipeline / Deal Integrity queue. Each is messy on purpose.
export const rawDeals = [
  {
    id: id("22222222", 1),
    source: "demo",
    owner_id: P.priya,
    // THE hard case: one-time + recurring blended, partner angle, dates decide records.
    raw_text:
      "Acme Retail: website rebuild ₹8L, delivery by 30 Nov, plus ₹50k/month support for 12 months starting Dec. Co-sold with AWS.",
  },
  {
    id: id("22222222", 2),
    source: "demo",
    owner_id: P.daniel,
    // Mislabelled type: clearly a retainer, rep tagged it one-time.
    raw_text:
      "Globex Logistics - Data Platform Retainer (type: one-time). ₹3,00,000 per month for 6 months, billing starts 1 Jan 2027.",
  },
  {
    id: id("22222222", 3),
    source: "demo",
    owner_id: P.priya,
    // Inconsistent naming for an existing client.
    raw_text:
      "ACME-Retail_Site_v2 -- add mobile checkout to the acme retail website. ₹4,50,000 fixed, go-live 15 Jan 2027.",
  },
  {
    id: id("22222222", 4),
    source: "demo",
    owner_id: P.daniel,
    // Ambiguous scope: no firm amount, no start date.
    raw_text:
      "Initech - ongoing support, TBD. Probably around ₹1L a month once the pilot wraps up. Pilot price not agreed yet.",
  },
  {
    id: id("22222222", 5),
    source: "demo",
    owner_id: P.priya,
    // Clean control case.
    raw_text:
      "Umbrella Health - AI Triage Chatbot Pilot. Fixed fee ₹12,00,000. Project ends 31 Dec 2026.",
  },
  {
    id: id("22222222", 6),
    source: "demo",
    owner_id: P.daniel,
    // Partner deal with MDF.
    raw_text:
      "Stark Industries - GenAI knowledge assistant, ₹15L fixed, delivery 28 Feb 2027. Co-sell with Microsoft; Microsoft contributing ₹2L via MDF, deal registered in Partner Center.",
  },
];

// Historical, already-approved deals so Clawback and Margin have data
// independent of the AI flow.
export const D = {
  wayne: id("33333333", 1),
  hooli: id("33333333", 2),
};

export const deals = [
  {
    id: D.wayne,
    raw_deal_id: null,
    name: "Wayne Enterprises - Analytics Dashboard",
    deal_type: "one_time",
    amount: 1000000,
    term_months: null,
    close_date: "2026-09-30",
    owner_id: P.priya,
    practice_split: { AI: 0.6, Web: 0.4 },
    partner: null,
    partner_flags: null,
    approved_by: "demo seed",
    approved_at: "2026-06-01T09:00:00Z",
  },
  {
    id: D.hooli,
    raw_deal_id: null,
    name: "Hooli SG - Cloud Migration",
    deal_type: "one_time",
    amount: 1000000,
    term_months: null,
    close_date: "2026-06-30",
    owner_id: P.daniel,
    practice_split: { Cloud: 1 },
    partner: null,
    partner_flags: null,
    approved_by: "demo seed",
    approved_at: "2026-04-01T09:00:00Z",
  },
];

const I = {
  wayneKickoff: id("44444444", 1),
  wayneUat: id("44444444", 2),
  wayneGoLive: id("44444444", 3),
  hooliFinal: id("44444444", 4),
};

const atStake = (amount: number) => Math.round(amount * 0.05);

export const invoices = [
  // Q3 invoice, fully paid -> safe
  { id: I.wayneKickoff, deal_id: D.wayne, milestone: "Kickoff 40%", amount: 400000, raised_on: "2026-07-15", owner_id: P.priya, variable_pay_at_stake: atStake(400000) },
  // Q3 invoice, partially paid -> partial (deadline 31 Dec 2026)
  { id: I.wayneUat, deal_id: D.wayne, milestone: "UAT 40%", amount: 400000, raised_on: "2026-09-10", owner_id: P.priya, variable_pay_at_stake: atStake(400000) },
  // Q3 invoice, unpaid -> exposure grows as deadline nears
  { id: I.wayneGoLive, deal_id: D.wayne, milestone: "Go-live 20%", amount: 200000, raised_on: "2026-09-29", owner_id: P.priya, variable_pay_at_stake: atStake(200000) },
  // Straddles quarter boundary: raised late Q2 (deadline 30 Sep 2026),
  // 60% paid before deadline, 40% paid 1 Oct (too late) -> 40% clawback.
  { id: I.hooliFinal, deal_id: D.hooli, milestone: "Final delivery 100%", amount: 1000000, raised_on: "2026-06-28", owner_id: P.daniel, variable_pay_at_stake: atStake(1000000) },
];

export const payments = [
  { id: id("55555555", 1), invoice_id: I.wayneKickoff, amount: 400000, paid_on: "2026-08-20" },
  { id: id("55555555", 2), invoice_id: I.wayneUat, amount: 150000, paid_on: "2026-10-01" },
  { id: id("55555555", 3), invoice_id: I.hooliFinal, amount: 600000, paid_on: "2026-09-20" },
  { id: id("55555555", 4), invoice_id: I.hooliFinal, amount: 400000, paid_on: "2026-10-01" },
];

export const timesheets = [
  // Wayne: quoted 10L. Planned ~160h IN + 30h SG (~48% margin). Actuals 220h IN +
  // 50h SG = 7.65L cost -> ~23.5% margin: scope creep below the 30% warning line.
  { id: id("66666666", 1), deal_id: D.wayne, location: "IN", hours: 70, logged_on: "2026-07-31" },
  { id: id("66666666", 2), deal_id: D.wayne, location: "SG", hours: 15, logged_on: "2026-07-31" },
  { id: id("66666666", 3), deal_id: D.wayne, location: "IN", hours: 90, logged_on: "2026-08-31" },
  { id: id("66666666", 4), deal_id: D.wayne, location: "SG", hours: 20, logged_on: "2026-08-31" },
  { id: id("66666666", 5), deal_id: D.wayne, location: "IN", hours: 60, logged_on: "2026-09-30" },
  { id: id("66666666", 6), deal_id: D.wayne, location: "SG", hours: 15, logged_on: "2026-09-30" },
  // Hooli: SG-heavy delivery.
  { id: id("66666666", 7), deal_id: D.hooli, location: "SG", hours: 45, logged_on: "2026-05-31" },
  { id: id("66666666", 8), deal_id: D.hooli, location: "IN", hours: 110, logged_on: "2026-06-30" },
];

// Insert order respects foreign keys; delete order is the reverse.
export const SEED_ORDER = [
  ["people", people, "id"],
  ["rates", rates, "location"],
  ["raw_deals", rawDeals, "id"],
  ["deals", deals, "id"],
  ["invoices", invoices, "id"],
  ["payments", payments, "id"],
  ["timesheets", timesheets, "id"],
] as const;

export const ALL_TABLES = [
  "people",
  "rates",
  "raw_deals",
  "deal_analyses",
  "deals",
  "onboarding_briefs",
  "invoices",
  "payments",
  "timesheets",
] as const;

// Children first.
export const RESET_ORDER = [
  "notifications",
  "payments",
  "invoices",
  "timesheets",
  "onboarding_briefs",
  "deals",
  "deal_analyses",
  "raw_deals",
  "rates",
  "people",
] as const;
