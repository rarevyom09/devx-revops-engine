// Invented demo dataset. Fixed UUIDs make "Load demo data" idempotent (upsert).
// Demo "today" is 2026-10-02 (start of Q4 2026, calendar quarters assumed).
// All clients are fictional. All money is INR.
import { addMonths, planInvoices, recurringSchedule, VARIABLE_PAY_RATE, type Milestone } from "./onboarding-validate";

const id = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SEED_TODAY = "2026-10-02";

export const P = {
  priya: id("11111111", 1),
  daniel: id("11111111", 2),
  arjun: id("11111111", 3),
  meilin: id("11111111", 4),
  rahul: id("11111111", 5),
  // Added for a fuller book of business (prefix 12121212).
  ananya: id("12121212", 1),
  karthik: id("12121212", 2),
  weijie: id("12121212", 3),
  sneha: id("12121212", 4),
  farhan: id("12121212", 5),
  deepa: id("12121212", 6),
};

export type SeedPerson = {
  id: string;
  name: string;
  role: "consulting_owner" | "practice_lead" | "delivery";
  entity: "IN" | "SG";
  variable_pay_target: number | null;
};

export const people: SeedPerson[] = [
  { id: P.priya, name: "Priya Sharma", role: "consulting_owner", entity: "IN", variable_pay_target: 400000 },
  { id: P.daniel, name: "Daniel Tan", role: "consulting_owner", entity: "SG", variable_pay_target: 600000 },
  { id: P.arjun, name: "Arjun Mehta", role: "practice_lead", entity: "IN", variable_pay_target: 250000 },
  { id: P.meilin, name: "Mei Lin Koh", role: "practice_lead", entity: "SG", variable_pay_target: 350000 },
  { id: P.rahul, name: "Rahul Verma", role: "delivery", entity: "IN", variable_pay_target: null },
  { id: P.ananya, name: "Ananya Iyer", role: "consulting_owner", entity: "IN", variable_pay_target: 325000 },
  { id: P.karthik, name: "Karthik Rao", role: "consulting_owner", entity: "IN", variable_pay_target: 300000 },
  { id: P.weijie, name: "Lim Wei Jie", role: "consulting_owner", entity: "SG", variable_pay_target: 550000 },
  { id: P.sneha, name: "Sneha Kulkarni", role: "practice_lead", entity: "IN", variable_pay_target: 220000 }, // Data practice
  { id: P.farhan, name: "Farhan Ismail", role: "practice_lead", entity: "SG", variable_pay_target: 320000 }, // Cloud practice
  { id: P.deepa, name: "Deepa Nair", role: "delivery", entity: "IN", variable_pay_target: null }, // delivery manager
];

export const rates = [
  { location: "IN", hourly_rate: 2000, currency: "INR" },
  { location: "SG", hourly_rate: 6500, currency: "INR" },
];

// Pending deals for the Pipeline / Deal Integrity queue. The first six are messy
// on purpose (tests depend on their ids and exact text); 7-9 are realistic
// rep-written deals (two clean, one blended with a partner).
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
  {
    id: id("24242424", 1),
    source: "demo",
    owner_id: P.karthik,
    // Clean one-time project.
    raw_text:
      "Brightwater Utilities - smart meter analytics dashboard. ₹14L fixed fee, signed PO received, delivery by 26 Feb 2027. Data team leads the pipelines, Web builds the front end.",
  },
  {
    id: id("24242424", 2),
    source: "demo",
    owner_id: P.weijie,
    // Clean retainer (follow-on from the Marina Crest migration).
    raw_text:
      "Marina Crest Insurance - managed data platform support after the claims cutover. ₹2,40,000 per month for 12 months, first invoice 1 Feb 2027.",
  },
  {
    id: id("24242424", 3),
    source: "demo",
    owner_id: P.ananya,
    // Blended project + retainer with a partner.
    raw_text:
      "Kaveri Agritech phase 2: farmer advisory chatbot (Hindi/Kannada) build ₹18L, go-live 31 Mar 2027, then ₹75k/month model ops support for 12 months from 1 Apr 2027. Google Cloud co-sell, deal registration submitted but not approved yet.",
  },
];

// ---------------------------------------------------------------------------
// Approved deals. Wayne and Hooli are the original historical deals (tests
// depend on them being deals[0] and deals[1], with their exact invoices,
// payments and timesheets). The rest is a realistic slice of the book.
// ---------------------------------------------------------------------------

export type SeedDeal = {
  id: string;
  raw_deal_id: string | null;
  name: string;
  deal_type: "one_time" | "recurring";
  amount: number;
  term_months: number | null;
  close_date: string;
  owner_id: string;
  practice_split: Record<string, number> | null;
  partner: string | null;
  partner_flags: { type?: string; deal_registered?: boolean | null; mdf_amount?: number | null; needs_review?: boolean } | null;
  approved_by: string;
  approved_at: string;
};

export const D = {
  wayne: id("33333333", 1),
  hooli: id("33333333", 2),
  kaveri: id("34343434", 1),
  marina: id("34343434", 2),
  saffron: id("34343434", 3),
  tanjong: id("34343434", 4),
  lotus: id("34343434", 5),
  northwind: id("34343434", 6),
  tamarind: id("34343434", 7),
  harbourline: id("34343434", 8),
  juniper: id("34343434", 9),
  monsoon: id("34343434", 10),
};

const baseDeals: SeedDeal[] = [
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

const atStake = (amount: number) => Math.round(amount * VARIABLE_PAY_RATE);

export type SeedInvoice = {
  id: string;
  deal_id: string;
  milestone: string;
  amount: number;
  raised_on: string;
  owner_id: string;
  variable_pay_at_stake: number;
};
export type SeedPayment = { id: string; invoice_id: string; amount: number; paid_on: string };
export type SeedTimesheet = { id: string; deal_id: string; location: "IN" | "SG"; hours: number; logged_on: string };

const baseInvoices: SeedInvoice[] = [
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

const basePayments: SeedPayment[] = [
  { id: id("55555555", 1), invoice_id: I.wayneKickoff, amount: 400000, paid_on: "2026-08-20" },
  { id: id("55555555", 2), invoice_id: I.wayneUat, amount: 150000, paid_on: "2026-10-01" },
  { id: id("55555555", 3), invoice_id: I.hooliFinal, amount: 600000, paid_on: "2026-09-20" },
  { id: id("55555555", 4), invoice_id: I.hooliFinal, amount: 400000, paid_on: "2026-10-01" },
];

const baseTimesheets: SeedTimesheet[] = [
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

// ---------------------------------------------------------------------------
// Book-of-business deals. Each spec drives: the deal row, an approved
// onboarding brief, invoices (computed by the same planInvoices() the app
// uses, so they sum exactly to the deal total), payments and timesheets.
// ---------------------------------------------------------------------------

type BriefText = {
  scope_summary: string;
  deliverables: string[];
  success_criteria: string[];
  risks_and_assumptions: string[];
  open_questions: string[];
};

type DealSpec = SeedDeal & {
  n: number; // stable number used to derive child ids
  brief: BriefText;
  brief_approved_by: string;
  brief_approved_at: string;
  milestones?: Milestone[]; // one-time only; recurring uses recurringSchedule()
  // Payment overrides by invoice index: [] = unpaid, [[amount, date], ...] = explicit.
  pay?: Record<number, [number, string][]>;
  // Monthly timesheets: [logged_on, IN hours, SG hours]
  hours: [string, number, number][];
};

const OPS_IN = "Rohan Kapoor (RevOps)";
const OPS_SG = "Grace Ong (RevOps)";

const specs: DealSpec[] = [
  {
    n: 1,
    id: D.kaveri,
    raw_deal_id: null,
    name: "Kaveri Agritech - Crop Yield Forecasting Model",
    deal_type: "one_time",
    amount: 2800000,
    term_months: null,
    close_date: "2026-12-15",
    owner_id: P.ananya,
    practice_split: { AI: 0.7, Data: 0.3 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2026-06-22T10:30:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2026-06-26T12:00:00Z",
    brief: {
      scope_summary:
        "Build a district-level crop yield forecasting model for Kaveri's procurement team, combining satellite NDVI, IMD rainfall and five seasons of mandi arrival data. Delivered as a weekly forecast API plus a dashboard for regional buyers.",
      deliverables: [
        "Data audit and feature store covering 42 districts",
        "Baseline yield model (paddy, maize, ragi) with backtest report",
        "Weekly forecast API and buyer dashboard",
        "Model card, retraining runbook and handover to Kaveri data team",
      ],
      success_criteria: [
        "Kharif 2026 forecast MAPE under 12% at district level",
        "Forecast published every Monday by 09:00 IST",
        "Kaveri data team retrains the model unaided before handover",
      ],
      risks_and_assumptions: [
        "Kaveri provides five seasons of cleaned mandi arrival data by kickoff",
        "Satellite imagery licence is Kaveri's cost (pass-through not included)",
        "Monsoon anomalies may widen error bands for the pilot season",
      ],
      open_questions: ["Will regional buyers need Kannada labels on the dashboard?"],
    },
    milestones: [
      { name: "Kickoff and data audit", pct: 25, due_date: "2026-07-06" },
      { name: "Baseline model sign-off", pct: 30, due_date: "2026-08-31" },
      { name: "Pilot season validation", pct: 30, due_date: "2026-11-16" },
      { name: "Production handover", pct: 15, due_date: "2026-12-15" },
    ],
    hours: [
      ["2026-07-31", 180, 8],
      ["2026-08-31", 220, 12],
      ["2026-09-30", 220, 12],
    ],
  },
  {
    n: 2,
    id: D.marina,
    raw_deal_id: null,
    name: "Marina Crest Insurance - Claims Platform Cloud Migration",
    deal_type: "one_time",
    amount: 4200000,
    term_months: null,
    close_date: "2027-01-29",
    owner_id: P.weijie,
    practice_split: { Cloud: 0.6, Data: 0.4 },
    partner: "Microsoft",
    partner_flags: { type: "co-sell", deal_registered: true, mdf_amount: 300000, needs_review: false },
    approved_by: OPS_SG,
    approved_at: "2026-06-24T03:00:00Z",
    brief_approved_by: "Farhan Ismail",
    brief_approved_at: "2026-06-30T04:00:00Z",
    brief: {
      scope_summary:
        "Migrate Marina Crest's on-premise claims platform and its reporting warehouse to Azure in two waves, with a Singapore-resident landing zone that meets MAS TRM guidelines. Onsite architects in Singapore, build and testing offshore.",
      deliverables: [
        "Azure landing zone with MAS TRM control mapping",
        "Wave 1: claims intake and adjudication services cut over",
        "Wave 2: reporting warehouse migrated to Azure Synapse",
        "Runbooks, DR test report and 6-week hypercare",
      ],
      success_criteria: [
        "Zero P1 incidents in the first 30 days after each cutover",
        "Claims batch completes within the existing 02:00-05:00 SGT window",
        "DR failover tested with RPO 15 min and RTO 4 h",
      ],
      risks_and_assumptions: [
        "Microsoft co-sell: deal registered, ₹3L MDF claimed separately (not revenue)",
        "Marina Crest security team signs off the landing zone within 10 working days",
        "Legacy mainframe extract format is as documented",
      ],
      open_questions: ["Does wave 2 need a parallel run for month-end close?"],
    },
    milestones: [
      { name: "Mobilisation", pct: 20, due_date: "2026-07-06" },
      { name: "Landing zone live", pct: 25, due_date: "2026-08-28" },
      { name: "Wave 1 cutover", pct: 30, due_date: "2026-11-27" },
      { name: "Hypercare exit", pct: 25, due_date: "2027-01-29" },
    ],
    // Landing-zone invoice: client paid ₹6L, holding ₹4.5L pending a security finding.
    pay: { 1: [[600000, "2026-09-25"]] },
    // SG-heavy: onsite architects in Singapore.
    hours: [
      ["2026-07-31", 60, 80],
      ["2026-08-31", 70, 90],
      ["2026-09-30", 70, 90],
    ],
  },
  {
    n: 3,
    id: D.saffron,
    raw_deal_id: null,
    name: "Saffron Retail Group - Ecommerce Replatform",
    deal_type: "one_time",
    amount: 3600000,
    term_months: null,
    close_date: "2026-11-30",
    owner_id: P.karthik,
    practice_split: { Web: 0.8, AI: 0.2 },
    partner: "Google Cloud",
    partner_flags: { type: "co-sell", deal_registered: false, mdf_amount: null, needs_review: true },
    approved_by: OPS_IN,
    approved_at: "2026-05-18T11:00:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2026-05-21T09:30:00Z",
    brief: {
      scope_summary:
        "Replatform Saffron's storefront from a legacy PHP monolith to a headless commerce stack on Google Cloud, with AI product search and recommendations. Covers 38 stores' click-and-collect and the festive-season catalogue.",
      deliverables: [
        "Headless storefront (web + PWA) on Google Cloud",
        "Catalogue and order migration from the legacy platform",
        "AI search and 'complete the look' recommendations",
        "Load test for 5x Diwali peak and go-live support",
      ],
      success_criteria: [
        "Checkout conversion at or above legacy baseline in the first 30 days",
        "p95 page load under 2.5 s on 4G",
        "Zero order loss during migration",
      ],
      risks_and_assumptions: [
        "Saffron's ERP team delivers the inventory API by end of June",
        "Go-live freeze from 15 Oct to 5 Nov for Diwali; UAT must finish before",
        "Google Cloud co-sell credits depend on deal registration",
      ],
      open_questions: ["Has Google approved the deal registration?"],
    },
    milestones: [
      { name: "Kickoff", pct: 25, due_date: "2026-05-25" },
      { name: "Design sign-off", pct: 25, due_date: "2026-06-26" },
      { name: "UAT sign-off", pct: 30, due_date: "2026-10-30" },
      { name: "Go-live", pct: 20, due_date: "2026-11-30" },
    ],
    // Paid late: 90 days after raising, scraped in before the 30 Sep deadline.
    pay: { 1: [[900000, "2026-09-24"]] },
    // Scope creep on the ERP integration: margin below target, above floor.
    hours: [
      ["2026-05-31", 120, 10],
      ["2026-06-30", 180, 16],
      ["2026-07-31", 200, 18],
      ["2026-08-31", 210, 18],
      ["2026-09-30", 190, 16],
    ],
  },
  {
    n: 4,
    id: D.tanjong,
    raw_deal_id: null,
    name: "Tanjong Freight - Cloud Ops Retainer",
    deal_type: "recurring",
    amount: 220000,
    term_months: 12,
    close_date: "2025-12-01",
    owner_id: P.weijie,
    practice_split: { Cloud: 1 },
    partner: "AWS",
    partner_flags: { type: "co-sell", deal_registered: true, mdf_amount: null, needs_review: false },
    approved_by: OPS_SG,
    approved_at: "2025-11-21T02:00:00Z",
    brief_approved_by: "Farhan Ismail",
    brief_approved_at: "2025-11-25T05:00:00Z",
    brief: {
      scope_summary:
        "Managed cloud operations for Tanjong Freight's AWS estate (container tracking, port EDI gateway, customer portal): 24x7 monitoring, patching, cost optimisation and a monthly service review.",
      deliverables: [
        "24x7 monitoring and on-call with 30-minute P1 response",
        "Monthly patching and quarterly DR drill",
        "Monthly FinOps report with savings recommendations",
        "Monthly service review with Tanjong's CTO office",
      ],
      success_criteria: [
        "99.9% monthly availability for the EDI gateway",
        "AWS spend down 15% versus the November 2025 baseline by month 6",
        "All P1s resolved within 4 hours",
      ],
      risks_and_assumptions: [
        "AWS co-sell registered; no MDF on this deal",
        "Scope excludes new feature development (separate SOW)",
      ],
      open_questions: [],
    },
    hours: [
      ["2025-12-31", 50, 8],
      ["2026-01-31", 50, 8],
      ["2026-02-28", 50, 8],
      ["2026-03-31", 50, 8],
      ["2026-04-30", 50, 8],
      ["2026-05-31", 50, 8],
      ["2026-06-30", 50, 8],
      ["2026-07-31", 50, 8],
      ["2026-08-31", 50, 8],
      ["2026-09-30", 50, 8],
    ],
  },
  {
    n: 5,
    id: D.lotus,
    raw_deal_id: null,
    name: "Lotus Ed - Learning Platform Support Retainer",
    deal_type: "recurring",
    amount: 85000,
    term_months: 15,
    close_date: "2025-11-01",
    owner_id: P.karthik,
    practice_split: { Web: 0.7, AI: 0.3 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2025-10-24T10:00:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2025-10-28T10:00:00Z",
    brief: {
      scope_summary:
        "Ongoing support and small enhancements for Lotus Ed's learning platform (web and Android) through the 2025-26 academic year and the January 2027 admissions cycle, including upkeep of the AI doubt-solver.",
      deliverables: [
        "L2/L3 support, business hours IST, with exam-week extended cover",
        "Up to 20 enhancement hours a month",
        "Monthly doubt-solver accuracy review and prompt updates",
      ],
      success_criteria: [
        "P1 response within 1 hour during exam weeks",
        "Doubt-solver answer acceptance above 85%",
      ],
      risks_and_assumptions: [
        "15-month term aligned to the admissions cycle ending January 2027",
        "LLM API usage billed to Lotus Ed directly",
      ],
      open_questions: [],
    },
    hours: [
      ["2025-11-30", 22, 2],
      ["2025-12-31", 22, 2],
      ["2026-01-31", 22, 2],
      ["2026-02-28", 22, 2],
      ["2026-03-31", 22, 2],
      ["2026-04-30", 22, 2],
      ["2026-05-31", 22, 2],
      ["2026-06-30", 22, 2],
      ["2026-07-31", 22, 2],
      ["2026-08-31", 22, 2],
      ["2026-09-30", 22, 2],
    ],
  },
  {
    n: 6,
    id: D.northwind,
    raw_deal_id: null,
    name: "Northwind Pharma - Regulatory Submission AI Assistant",
    deal_type: "one_time",
    amount: 4500000,
    term_months: null,
    close_date: "2027-03-31",
    owner_id: P.ananya,
    practice_split: { AI: 0.8, Data: 0.2 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2026-07-24T08:30:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2026-07-29T08:30:00Z",
    brief: {
      scope_summary:
        "A GenAI assistant for Northwind Pharma's regulatory affairs team in Hyderabad that drafts CTD Module 2 summaries from source study reports, with citation to the source page and a reviewer workflow. Hosted in Northwind's own cloud tenant.",
      deliverables: [
        "Document ingestion and retrieval over ~40,000 study report pages",
        "Drafting assistant for Module 2.5 / 2.7 with source citations",
        "Reviewer workflow with audit trail (21 CFR Part 11 aligned)",
        "Validation package and user training",
      ],
      success_criteria: [
        "Reviewers accept at least 70% of drafted paragraphs with minor edits",
        "Every generated sentence links to a source page",
        "Computer system validation signed off by Northwind QA",
      ],
      risks_and_assumptions: [
        "Northwind provisions GPU quota in its tenant by September",
        "Validation effort may grow if QA requires full IQ/OQ/PQ",
        "Kickoff invoice awaiting PO number from Northwind procurement",
      ],
      open_questions: ["Is Module 2.4 (non-clinical) in scope for phase 1?"],
    },
    milestones: [
      { name: "Kickoff", pct: 20, due_date: "2026-08-03" },
      { name: "Prototype sign-off", pct: 25, due_date: "2026-11-30" },
      { name: "Validation complete", pct: 30, due_date: "2027-02-15" },
      { name: "Go-live", pct: 25, due_date: "2027-03-31" },
    ],
    // Kickoff invoice stuck on a PO number: unpaid, deadline 31 Dec (normal for now).
    pay: { 0: [] },
    hours: [
      ["2026-08-31", 320, 40],
      ["2026-09-30", 380, 40],
    ],
  },
  {
    n: 7,
    id: D.tamarind,
    raw_deal_id: null,
    name: "Tamarind Microfinance - Loan Book Data Warehouse",
    deal_type: "one_time",
    amount: 1850000,
    term_months: null,
    close_date: "2026-10-30",
    owner_id: P.karthik,
    practice_split: { Data: 1 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2026-06-05T09:00:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2026-06-09T09:00:00Z",
    brief: {
      scope_summary:
        "Consolidate Tamarind's loan book from three branch systems into a single warehouse with daily PAR and collection-efficiency reporting for the credit committee and RBI returns.",
      deliverables: [
        "Ingestion pipelines from three loan origination systems",
        "Dimensional model for loans, repayments and branches",
        "PAR 30/90 and collection-efficiency dashboards",
        "Data quality checks and runbook",
      ],
      success_criteria: [
        "Daily refresh complete by 07:00 IST",
        "Loan book reconciles to the GL within 0.1%",
      ],
      risks_and_assumptions: ["Branch system vendors provide read replicas"],
      open_questions: [],
    },
    milestones: [
      { name: "Kickoff", pct: 30, due_date: "2026-06-15" },
      { name: "Pipelines live", pct: 40, due_date: "2026-08-14" },
      { name: "Go-live", pct: 30, due_date: "2026-10-30" },
    ],
    hours: [
      ["2026-06-30", 120, 4],
      ["2026-07-31", 170, 5],
      ["2026-08-31", 110, 5],
      ["2026-09-30", 50, 0],
    ],
  },
  {
    n: 8,
    id: D.harbourline,
    raw_deal_id: null,
    name: "Harbourline Bank - AI Model Monitoring Retainer",
    deal_type: "recurring",
    amount: 180000,
    term_months: 12,
    close_date: "2026-02-01",
    owner_id: P.weijie,
    practice_split: { AI: 0.5, Data: 0.5 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_SG,
    approved_at: "2026-01-20T03:00:00Z",
    brief_approved_by: "Farhan Ismail",
    brief_approved_at: "2026-01-23T03:00:00Z",
    brief: {
      scope_summary:
        "Monthly monitoring of Harbourline Bank's credit-scoring and transaction-fraud models: drift detection, fairness checks and a model-risk report for the bank's MRM committee.",
      deliverables: [
        "Automated drift and stability monitoring (PSI/CSI) for 6 models",
        "Monthly model-risk report for the MRM committee",
        "Quarterly fairness review across customer segments",
      ],
      success_criteria: [
        "Report delivered by the 5th working day of each month",
        "Drift breaches escalated within 1 business day",
      ],
      risks_and_assumptions: ["Bank provides monthly scoring extracts by the 2nd working day"],
      open_questions: [],
    },
    // September invoice not yet paid (raised 1 Sep, normal 30-45 day cycle).
    pay: { 7: [] },
    hours: [
      ["2026-02-28", 35, 10],
      ["2026-03-31", 35, 10],
      ["2026-04-30", 35, 10],
      ["2026-05-31", 35, 10],
      ["2026-06-30", 35, 10],
      ["2026-07-31", 35, 10],
      ["2026-08-31", 35, 10],
      ["2026-09-30", 35, 10],
    ],
  },
  {
    n: 9,
    id: D.juniper,
    raw_deal_id: null,
    name: "Juniper Stays - Booking Website Rebuild",
    deal_type: "one_time",
    amount: 960000,
    term_months: null,
    close_date: "2026-12-18",
    owner_id: P.ananya,
    practice_split: null, // deliberately missing: approved before the split was captured
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2026-08-12T07:00:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2026-08-18T07:00:00Z",
    brief: {
      scope_summary:
        "Rebuild Juniper Stays' booking website for its 14 boutique properties: new design system, direct-booking engine integration and multilingual content, ahead of the December holiday season.",
      deliverables: [
        "Responsive site on a headless CMS",
        "Booking engine and payment gateway integration",
        "English, Hindi and German content",
      ],
      success_criteria: [
        "Direct bookings up 20% versus last December",
        "Lighthouse performance score above 85 on mobile",
      ],
      risks_and_assumptions: ["Booking engine vendor sandbox available from September"],
      open_questions: ["Which practice owns the booking-engine integration work?"],
    },
    milestones: [
      { name: "Kickoff", pct: 40, due_date: "2026-08-24" },
      { name: "UAT sign-off", pct: 40, due_date: "2026-11-20" },
      { name: "Go-live", pct: 20, due_date: "2026-12-18" },
    ],
    hours: [
      ["2026-08-31", 60, 2],
      ["2026-09-30", 140, 6],
    ],
  },
  {
    n: 10,
    id: D.monsoon,
    raw_deal_id: null,
    name: "Monsoon Living - Storefront Care Retainer",
    deal_type: "recurring",
    amount: 45000,
    term_months: 18,
    close_date: "2025-09-01",
    owner_id: P.karthik,
    practice_split: { Web: 1 },
    partner: null,
    partner_flags: null,
    approved_by: OPS_IN,
    approved_at: "2025-08-25T09:00:00Z",
    brief_approved_by: "Deepa Nair",
    brief_approved_at: "2025-08-27T09:00:00Z",
    brief: {
      scope_summary:
        "Monthly care plan for Monsoon Living's home-decor storefront: uptime monitoring, theme and app updates, and up to 12 hours of small changes a month.",
      deliverables: ["Uptime and checkout monitoring", "Monthly theme/app updates", "Up to 12 change hours a month"],
      success_criteria: ["Checkout availability 99.9%", "Change requests closed within 3 working days"],
      risks_and_assumptions: ["Unused change hours do not roll over"],
      open_questions: [],
    },
    hours: [
      ["2025-09-30", 15, 0],
      ["2025-10-31", 15, 0],
      ["2025-11-30", 15, 0],
      ["2025-12-31", 15, 0],
      ["2026-01-31", 15, 0],
      ["2026-02-28", 15, 0],
      ["2026-03-31", 15, 0],
      ["2026-04-30", 15, 0],
      ["2026-05-31", 15, 0],
      ["2026-06-30", 15, 0],
      ["2026-07-31", 15, 0],
      ["2026-08-31", 15, 0],
      ["2026-09-30", 15, 0],
    ],
  },
];

// Deterministic payment lag (days) so not every client pays on the same day.
const LAGS = [21, 28, 18, 33, 25, 14, 30, 24, 19, 27];
const addDaysIso = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const book = specs.map((s) => {
  const { n, brief, brief_approved_by, brief_approved_at, milestones, pay, hours, ...deal } = s;
  const ms = deal.deal_type === "recurring" ? recurringSchedule(deal) : milestones!;
  const planned = planInvoices(deal, ms);
  const invs: SeedInvoice[] = planned.map((p, i) => ({
    id: id("56565656", n * 100 + i + 1),
    deal_id: deal.id,
    milestone: p.milestone,
    amount: p.amount,
    raised_on: p.raised_on,
    owner_id: deal.owner_id,
    variable_pay_at_stake: p.variable_pay_at_stake,
  }));
  const pays: SeedPayment[] = [];
  invs.forEach((inv, i) => {
    if (inv.raised_on > SEED_TODAY) return; // scheduled, not raised yet
    const plan = pay?.[i] ?? [[inv.amount, addDaysIso(inv.raised_on, LAGS[(n + i) % LAGS.length])]];
    plan.forEach(([amount, on], k) => {
      if (on >= SEED_TODAY) return; // not paid yet as of demo today
      pays.push({ id: id("78787878", n * 1000 + i * 10 + k + 1), invoice_id: inv.id, amount, paid_on: on });
    });
  });
  const sheets: SeedTimesheet[] = [];
  hours.forEach(([on, inH, sgH], k) => {
    if (inH > 0) sheets.push({ id: id("90909090", n * 1000 + k * 2 + 1), deal_id: deal.id, location: "IN", hours: inH, logged_on: on });
    if (sgH > 0) sheets.push({ id: id("90909090", n * 1000 + k * 2 + 2), deal_id: deal.id, location: "SG", hours: sgH, logged_on: on });
  });
  const briefRow = {
    id: id("13131313", n),
    deal_id: deal.id,
    brief: { ...brief, validator_flags: [] as string[], source: "seed", model: null, validated_on: brief_approved_at.slice(0, 10) },
    milestones: ms,
    status: "approved" as const,
    approved_by: brief_approved_by,
    approved_at: brief_approved_at,
  };
  return { deal, invs, pays, sheets, briefRow };
});

export const deals: SeedDeal[] = [...baseDeals, ...book.map((b) => b.deal)];
export const onboardingBriefs = book.map((b) => b.briefRow);
export const invoices: SeedInvoice[] = [...baseInvoices, ...book.flatMap((b) => b.invs)];
export const payments: SeedPayment[] = [...basePayments, ...book.flatMap((b) => b.pays)];
export const timesheets: SeedTimesheet[] = [...baseTimesheets, ...book.flatMap((b) => b.sheets)];

/** Retainer end date (exclusive), same convention as the leak engine. */
export const termEnd = (d: Pick<SeedDeal, "close_date" | "term_months">) =>
  d.term_months ? addMonths(d.close_date, d.term_months) : null;

// Insert order respects foreign keys; delete order is the reverse.
export const SEED_ORDER = [
  ["people", people, "id"],
  ["rates", rates, "location"],
  ["raw_deals", rawDeals, "id"],
  ["deals", deals, "id"],
  ["onboarding_briefs", onboardingBriefs, "id"],
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

// Children first. action_drafts and notifications reference deals/people.
export const RESET_ORDER = [
  "action_drafts",
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
