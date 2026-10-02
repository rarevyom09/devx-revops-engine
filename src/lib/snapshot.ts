import "server-only";
import { DEMO_TODAY, evaluateAll, type InvoiceClawback } from "./clawback";
import { db, must } from "./db";
import { findLeaks, type Alert, type DealIn, type MarginIn, type Stage } from "./leaks";
import { computeMargin, dealPrice, sumHours, type Rates } from "./margin";
import type { Engine } from "./modules";

// One read of every table plus everything derived from it (clawback, margin,
// leak alerts). Shared by the home flow and the deal board so both agree.

export type RawStatus = "pending" | "analysed" | "approved" | "rejected";
export type AnalysisRow = {
  id: string;
  raw_deal_id: string;
  model: string | null;
  confidence: "high" | "medium" | "low";
  output: {
    is_blended?: boolean;
    ambiguities?: (string | { question?: string })[];
    reasoning?: string;
    records?: unknown[];
    [k: string]: unknown;
  } | null;
  validator_flags: { flags?: { code: string; message: string }[] } | null;
  rep_answers?: { index: number; answer?: string | null }[] | null; // column may not exist yet
  created_at: string;
};
export type RawRow = { id: string; status: RawStatus; raw_text: string; source: string | null; owner_id: string | null; created_at: string };
export type DealRow = {
  id: string;
  raw_deal_id: string | null;
  name: string;
  deal_type: "one_time" | "recurring";
  amount: number;
  term_months: number | null;
  close_date: string;
  owner_id: string | null;
  practice_split: Record<string, number> | null;
  partner: string | null;
  partner_flags: DealIn["partner_flags"];
  approved_by: string | null;
  approved_at: string | null;
};
export type BriefRow = {
  deal_id: string;
  status: "draft" | "approved";
  milestones: { name: string; pct: number; due_date: string }[] | null;
  approved_by: string | null;
  approved_at: string | null;
};
export type InvoiceRow = {
  id: string;
  deal_id: string;
  milestone: string;
  amount: number;
  raised_on: string;
  owner_id: string | null;
  variable_pay_at_stake: number | null;
  deals: { name: string } | null;
  people: { name: string } | null;
};
export type PaymentRow = { invoice_id: string; amount: number; paid_on: string };
export type EvaluatedInvoice = InvoiceClawback & { deal_id: string };
export type DealMargin = MarginIn;

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

export async function loadSnapshot(asOf = DEMO_TODAY) {
  const [raw, analyses, deals, briefs, invoices, payments, rateRows, sheets, people] = await Promise.all([
    db().from("raw_deals").select("id,status,raw_text,source,owner_id,created_at").then(must) as Promise<RawRow[]>,
    db().from("deal_analyses").select("*").order("created_at", { ascending: false }).then(must) as Promise<AnalysisRow[]>,
    db().from("deals").select("id,raw_deal_id,name,deal_type,amount,term_months,close_date,owner_id,practice_split,partner,partner_flags,approved_by,approved_at").then(must) as Promise<DealRow[]>,
    db().from("onboarding_briefs").select("deal_id,status,milestones,approved_by,approved_at").then(must) as Promise<BriefRow[]>,
    db().from("invoices").select("id,deal_id,milestone,amount,raised_on,owner_id,variable_pay_at_stake,deals(name),people(name)").then(must) as unknown as Promise<InvoiceRow[]>,
    db().from("payments").select("invoice_id,amount,paid_on").then(must) as Promise<PaymentRow[]>,
    db().from("rates").select("location,hourly_rate").then(must) as Promise<{ location: string; hourly_rate: number }[]>,
    db().from("timesheets").select("deal_id,location,hours").then(must) as Promise<{ deal_id: string; location: string; hours: number }[]>,
    db().from("people").select("id,name").then(must) as Promise<{ id: string; name: string }[]>,
  ]);

  const latest = new Map<string, AnalysisRow>();
  for (const a of analyses) if (!latest.has(a.raw_deal_id)) latest.set(a.raw_deal_id, a);

  const total = (d: DealRow) => dealPrice({ ...d, amount: Number(d.amount) }).price;
  const sum = (xs: { amount: number | string }[]) => xs.reduce((s, x) => s + Number(x.amount), 0);
  const briefStatus = (id: string): DealIn["brief_status"] =>
    briefs.some((b) => b.deal_id === id && b.status === "approved") ? "approved"
      : briefs.some((b) => b.deal_id === id) ? "draft" : "none";

  // Same rules as the Clawback tab. deal_id is carried alongside for attribution.
  const evals: EvaluatedInvoice[] = evaluateAll(
    invoices.map((i) => ({
      id: i.id, milestone: i.milestone, amount: Number(i.amount), raised_on: i.raised_on, owner_id: i.owner_id,
      variable_pay_at_stake: i.variable_pay_at_stake == null ? null : Number(i.variable_pay_at_stake),
      deal_name: i.deals?.name ?? null,
      owner_name: i.people?.name ?? null,
    })),
    payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    asOf,
  ).map((e) => ({ ...e, deal_id: invoices.find((i) => i.id === e.id)!.deal_id }));

  // Same rules as the Margin tab.
  const rates: Rates = { IN: 0, SG: 0 };
  for (const r of rateRows) if (r.location === "IN" || r.location === "SG") rates[r.location] = Number(r.hourly_rate);
  const margins: DealMargin[] = deals.map((d) => ({
    deal_id: d.id,
    name: d.name,
    ...computeMargin({ ...d, amount: Number(d.amount) }, sumHours(sheets.filter((t) => t.deal_id === d.id)), rates),
  }));

  const alerts: Alert[] = findLeaks({
    today: asOf,
    rawDeals: raw.map((r) => {
      const a = latest.get(r.id);
      return {
        id: r.id, raw_text: r.raw_text, status: r.status,
        analysis: a ? {
          confidence: a.confidence,
          flags: a.validator_flags?.flags?.length ?? 0,
          ambiguities: a.output?.ambiguities?.length ?? 0,
          is_blended: !!a.output?.is_blended,
        } : null,
      };
    }),
    deals: deals.map((d): DealIn => ({
      id: d.id, name: d.name, deal_type: d.deal_type, amount: Number(d.amount), term_months: d.term_months,
      close_date: d.close_date, total: total(d), practice_split: d.practice_split, partner: d.partner,
      partner_flags: d.partner_flags, brief_status: briefStatus(d.id),
      scheduled_invoice_total: sum(invoices.filter((i) => i.deal_id === d.id)),
    })),
    invoices: evals,
    margins,
  });

  return {
    asOf,
    raw: raw.map((r) => ({ ...r, analysis: latest.get(r.id) ?? null })),
    analyses,
    deals: deals.map((d) => ({
      ...d,
      amount: Number(d.amount),
      total: total(d),
      brief_status: briefStatus(d.id),
      brief: briefs.find((b) => b.deal_id === d.id && b.status === "approved") ?? briefs.find((b) => b.deal_id === d.id) ?? null,
      invoices: invoices.filter((i) => i.deal_id === d.id),
    })),
    invoices,
    payments,
    evals,
    margins,
    alerts,
    people: new Map(people.map((p) => [p.id, p.name])),
  };
}

export type FlowStage = {
  key: Stage;
  counts: Record<"critical" | "warning" | "info", number>;
  label: string;
  href: string;
  engine: Engine;
  headline: string;
  detail: string;
  leak: { count: number; label: string };
};

// Stage summaries for the home page: a headline and the leak per stage.
export function flowStages(s: Snapshot): FlowStage[] {
  const { asOf, raw, analyses, deals, invoices, payments, evals, margins, alerts } = s;
  const sum = (xs: { amount: number | string }[]) => xs.reduce((t, x) => t + Number(x.amount), 0);

  // 1. Deal integrity
  const open = raw.filter((r) => r.status === "pending" || r.status === "analysed");
  const unanalysed = open.filter((r) => !r.analysis).length;
  const openAnalyses = open.map((r) => r.analysis).filter((a) => !!a);
  const lowConf = openAnalyses.filter((a) => a.confidence === "low").length;
  const blended = analyses.filter((a) => a.output?.is_blended).length;
  const flagged = openAnalyses.filter((a) => (a.validator_flags?.flags?.length ?? 0) > 0).length;

  // 2. Booking
  const bookedValue = deals.reduce((t, d) => t + d.total, 0);
  const invoicedDeals = new Set(invoices.map((i) => i.deal_id));
  const approvedBrief = new Set(deals.filter((d) => d.brief_status === "approved").map((d) => d.id));
  const noBillingPlan = deals.filter((d) => !approvedBrief.has(d.id) && !invoicedDeals.has(d.id));

  // 3. Invoice
  const raised = invoices.filter((i) => i.raised_on <= asOf);
  const scheduled = invoices.filter((i) => i.raised_on > asOf);
  const unbilled = deals.reduce((t, d) => t + Math.max(0, d.total - sum(d.invoices)), 0);

  // 4. Realization
  const collected = payments.filter((p) => p.paid_on <= asOf).reduce((t, p) => t + Number(p.amount), 0);
  const overdue = evals.filter((e) => e.status === "overdue_exposure");
  const atRisk = evals.filter((e) => e.status === "at_risk");
  const realised = evals.reduce((t, e) => t + e.realised_clawback, 0);
  const projected = evals.reduce((t, e) => t + e.projected_exposure, 0);

  // 5. Margin
  const tracked = margins.filter((m) => m.status !== "no_hours");
  const warnings = tracked.filter((m) => m.status === "warning");

  const count = (st: Stage) => {
    const mine = alerts.filter((a) => a.stage === st);
    return { critical: mine.filter((a) => a.severity === "critical").length, warning: mine.filter((a) => a.severity === "warning").length, info: mine.filter((a) => a.severity === "info").length };
  };
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  return [
    {
      key: "deal", counts: count("deal"), label: "Deal", href: "/pipeline", engine: "ai",
      headline: `${open.length} raw deal${open.length === 1 ? "" : "s"} awaiting review`,
      detail: `${unanalysed} not yet analysed · ${blended} blended deal${blended === 1 ? "" : "s"} caught`,
      leak: { count: lowConf + flagged + unanalysed, label: `${flagged} with failed checks, ${lowConf} low confidence, ${unanalysed} unreviewed` },
    },
    {
      key: "booking", counts: count("booking"), label: "Booking", href: "/onboarding", engine: "ai",
      headline: `${deals.length} approved deal${deals.length === 1 ? "" : "s"} · ${inr(bookedValue)}`,
      detail: `${approvedBrief.size} with approved billing plan`,
      leak: { count: noBillingPlan.length, label: `${noBillingPlan.length} booked with no billing plan (won't get invoiced)` },
    },
    {
      key: "invoice", counts: count("invoice"), label: "Invoice", href: "/clawback", engine: "rules",
      headline: `${inr(sum(raised))} invoiced`,
      detail: `${scheduled.length} scheduled (${inr(sum(scheduled))}) · drives variable pay`,
      leak: { count: unbilled > 0 ? 1 : 0, label: `${inr(unbilled)} of booked value has no invoice planned` },
    },
    {
      key: "cash", counts: count("cash"), label: "Realization", href: "/clawback", engine: "rules",
      headline: `${inr(collected)} collected`,
      detail: `${inr(realised)} clawed back · ${inr(projected)} exposure if nothing more is paid`,
      leak: { count: overdue.length + atRisk.length, label: `${overdue.length} missed deadline, ${atRisk.length} at risk (≤60 days)` },
    },
    {
      key: "margin", counts: count("margin"), label: "Margin", href: "/margin", engine: "rules",
      headline: `${tracked.length} deal${tracked.length === 1 ? "" : "s"} with hours logged`,
      detail: warnings.map((w) => `${w.name}: ${((w.margin_pct ?? 0) * 100).toFixed(1)}%`).join(" · ") || "all above 30%",
      leak: { count: warnings.length, label: `${warnings.length} below the 30% margin floor` },
    },
  ];
}

// ---------- Deal board ----------

export type ColumnKey = "intake" | "review" | "booked" | "onboarded" | "invoicing" | "collected";
export const COLUMNS: { key: ColumnKey; label: string; hint: string }[] = [
  { key: "intake", label: "Intake", hint: "Raw text, not yet analysed" },
  { key: "review", label: "Needs review", hint: "AI proposal awaiting human approval" },
  { key: "booked", label: "Booked", hint: "Approved, no billing plan yet" },
  { key: "onboarded", label: "Onboarded", hint: "Billing plan set, nothing invoiced yet" },
  { key: "invoicing", label: "Invoicing", hint: "Invoiced, cash still outstanding" },
  { key: "collected", label: "Collected / Live", hint: "Everything raised so far is paid" },
];

export type Question = { question: string; answer: string | null };
export type IntakeDetail = {
  raw_deal_id: string;
  raw_text: string;
  source: string | null;
  status: RawStatus;
  analysis: {
    confidence: AnalysisRow["confidence"];
    model: string | null;
    analysed_at: string;
    flags: { code: string; message: string }[];
    questions: Question[];
    reasoning: string | null;
    proposed: string[];
  } | null;
};
export type InvoiceLine = {
  id: string;
  milestone: string;
  amount: number;
  raised_on: string;
  raised: boolean;
  paid: number;
  outstanding: number;
  deadline: string | null;
  days_left: number | null;
  status: InvoiceClawback["status"] | "scheduled";
  variable_pay_at_stake: number;
  realised_clawback: number;
  projected_exposure: number;
};
export type BoardCard = {
  key: string;
  kind: "raw" | "deal";
  id: string;
  column: ColumnKey;
  title: string;
  owner: string | null;
  deal_type: DealRow["deal_type"] | null;
  amount: number | null;
  term_months: number | null;
  total: number | null;
  close_date: string | null;
  partner: string | null;
  status_label: string | null;
  confidence: AnalysisRow["confidence"] | null;
  flag_count: number;
  open_questions: number;
  counts: { critical: number; warning: number; info: number };
  next_action: { label: string; href: string };
  split: { raw_deal_id: string; siblings: { id: string; name: string }[] } | null;
  alerts: Alert[];
  intake: IntakeDetail | null;
  deal: (Omit<DealRow, "owner_id"> & { total: number; term_end: string | null }) | null;
  brief: { status: BriefRow["status"]; milestones: NonNullable<BriefRow["milestones"]>; approved_by: string | null; approved_at: string | null } | null;
  invoices: InvoiceLine[];
  margin: DealMargin | null;
};
export type Board = { asOf: string; columns: typeof COLUMNS; cards: BoardCard[]; rejected: number };

function questionsOf(a: AnalysisRow): Question[] {
  const answers = new Map<number, string>();
  for (const r of Array.isArray(a.rep_answers) ? a.rep_answers : []) {
    if (r && typeof r.index === "number" && r.answer && String(r.answer).trim()) answers.set(r.index, String(r.answer));
  }
  return (a.output?.ambiguities ?? []).map((q, i) => ({
    question: typeof q === "string" ? q : (q?.question ?? JSON.stringify(q)),
    answer: answers.get(i) ?? null,
  }));
}

function intakeOf(r: Snapshot["raw"][number]): IntakeDetail {
  const a = r.analysis;
  return {
    raw_deal_id: r.id,
    raw_text: r.raw_text,
    source: r.source,
    status: r.status,
    analysis: a ? {
      confidence: a.confidence,
      model: a.model,
      analysed_at: a.created_at,
      flags: a.validator_flags?.flags ?? [],
      questions: questionsOf(a),
      reasoning: typeof a.output?.reasoning === "string" ? a.output.reasoning : null,
      proposed: (a.output?.records ?? []).map((x) => (x as { name?: string })?.name).filter((n): n is string => !!n),
    } : null,
  };
}

function addMonthsUTC(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

const inrShort = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const countSev = (xs: Alert[]) => ({
  critical: xs.filter((a) => a.severity === "critical").length,
  warning: xs.filter((a) => a.severity === "warning").length,
  info: xs.filter((a) => a.severity === "info").length,
});

export function buildBoard(s: Snapshot): Board {
  const { asOf } = s;
  const cards: BoardCard[] = [];
  const blank: Pick<BoardCard, "deal_type" | "amount" | "term_months" | "total" | "close_date" | "partner" | "status_label" | "deal" | "brief" | "invoices" | "margin" | "split"> = {
    deal_type: null, amount: null, term_months: null, total: null, close_date: null, partner: null, status_label: null,
    deal: null, brief: null, invoices: [], margin: null, split: null,
  };

  for (const r of s.raw) {
    if (r.status === "approved" || r.status === "rejected") continue;
    const intake = intakeOf(r);
    const a = intake.analysis;
    const alerts = s.alerts.filter((x) => x.ref.kind === "raw" && x.ref.id === r.id);
    const column: ColumnKey = a ? "review" : "intake";
    const open = a ? a.questions.filter((q) => !q.answer).length : 0;
    const top = alerts.find((x) => x.severity !== "info");
    cards.push({
      ...blank,
      key: `raw:${r.id}`, kind: "raw", id: r.id, column,
      title: r.raw_text.length > 90 ? `${r.raw_text.slice(0, 87)}…` : r.raw_text,
      owner: r.owner_id ? (s.people.get(r.owner_id) ?? null) : null,
      confidence: a?.confidence ?? null,
      flag_count: a?.flags.length ?? 0,
      open_questions: open,
      counts: countSev(alerts),
      next_action: !a ? { label: "Analyse with AI", href: "/pipeline" }
        : top ? { label: top.action, href: top.href }
        : open ? { label: `Answer ${open} rep question${open === 1 ? "" : "s"}, then approve`, href: "/pipeline" }
        : { label: "Approve", href: "/pipeline" },
      alerts, intake,
    });
  }

  const byRaw = new Map<string, { id: string; name: string }[]>();
  for (const d of s.deals) if (d.raw_deal_id) byRaw.set(d.raw_deal_id, [...(byRaw.get(d.raw_deal_id) ?? []), { id: d.id, name: d.name }]);

  for (const d of s.deals) {
    const alerts = s.alerts.filter((x) => x.ref.deal_id === d.id);
    const paidToDate = (invoiceId: string) =>
      s.payments.filter((p) => p.invoice_id === invoiceId && p.paid_on <= asOf).reduce((t, p) => t + Number(p.amount), 0);
    const invoices: InvoiceLine[] = d.invoices
      .map((i): InvoiceLine => {
        const e = s.evals.find((x) => x.id === i.id);
        const paid = paidToDate(i.id);
        return e ? {
          id: i.id, milestone: i.milestone, amount: e.amount, raised_on: i.raised_on, raised: true, paid,
          outstanding: e.outstanding, deadline: e.deadline, days_left: e.days_left, status: e.status,
          variable_pay_at_stake: Number(e.variable_pay_at_stake ?? 0), realised_clawback: e.realised_clawback, projected_exposure: e.projected_exposure,
        } : {
          id: i.id, milestone: i.milestone, amount: Number(i.amount), raised_on: i.raised_on, raised: false, paid,
          outstanding: Number(i.amount) - paid, deadline: null, days_left: null, status: "scheduled",
          variable_pay_at_stake: Number(i.variable_pay_at_stake ?? 0), realised_clawback: 0, projected_exposure: 0,
        };
      })
      .sort((a, b) => a.raised_on.localeCompare(b.raised_on));
    const raised = invoices.filter((i) => i.raised);
    const scheduled = invoices.filter((i) => !i.raised);
    const outstanding = raised.reduce((t, i) => t + i.outstanding, 0);
    const termEnd = d.deal_type === "recurring" && d.term_months ? addMonthsUTC(d.close_date, d.term_months) : null;

    const column: ColumnKey =
      d.brief_status !== "approved" && invoices.length === 0 ? "booked"
        : raised.length === 0 ? "onboarded"
        : outstanding > 0.5 ? "invoicing"
        : "collected";
    const status_label =
      column !== "collected" ? null
        : termEnd && termEnd > asOf ? "Live"
        : scheduled.length ? "Paid to date"
        : "Collected";

    const top = alerts.find((x) => x.severity !== "info");
    const next = scheduled[0];
    const fallback =
      column === "booked" ? { label: d.brief_status === "draft" ? "Approve onboarding brief" : "Draft onboarding brief", href: "/onboarding" }
        : column === "onboarded" ? { label: next ? `First invoice ${next.raised_on}` : "Schedule invoices", href: "/onboarding" }
        : column === "invoicing" ? { label: `Collect ${inrShort(outstanding)} outstanding`, href: "/clawback" }
        : next ? { label: `Next invoice ${next.raised_on}`, href: "/clawback" }
        : { label: "Nothing due", href: "/clawback" };

    const raw = d.raw_deal_id ? s.raw.find((r) => r.id === d.raw_deal_id) : undefined;
    const siblings = d.raw_deal_id ? (byRaw.get(d.raw_deal_id) ?? []) : [];
    cards.push({
      key: `deal:${d.id}`, kind: "deal", id: d.id, column,
      title: d.name,
      owner: d.owner_id ? (s.people.get(d.owner_id) ?? null) : null,
      deal_type: d.deal_type, amount: d.amount, term_months: d.term_months, total: d.total, close_date: d.close_date,
      partner: d.partner, status_label,
      confidence: raw?.analysis?.confidence ?? null,
      flag_count: raw?.analysis?.validator_flags?.flags?.length ?? 0,
      open_questions: 0,
      counts: countSev(alerts),
      next_action: top ? { label: top.action, href: top.href } : fallback,
      split: siblings.length > 1 && d.raw_deal_id ? { raw_deal_id: d.raw_deal_id, siblings: siblings.filter((x) => x.id !== d.id) } : null,
      alerts,
      intake: raw ? intakeOf(raw) : null,
      deal: {
        id: d.id, raw_deal_id: d.raw_deal_id, name: d.name, deal_type: d.deal_type, amount: d.amount,
        term_months: d.term_months, close_date: d.close_date, practice_split: d.practice_split, partner: d.partner,
        partner_flags: d.partner_flags, approved_by: d.approved_by, approved_at: d.approved_at, total: d.total, term_end: termEnd,
      },
      brief: d.brief ? { status: d.brief.status, milestones: d.brief.milestones ?? [], approved_by: d.brief.approved_by, approved_at: d.brief.approved_at } : null,
      invoices,
      margin: s.margins.find((m) => m.deal_id === d.id) ?? null,
    });
  }

  const sev = (c: BoardCard) => c.counts.critical * 100 + c.counts.warning;
  cards.sort((a, b) => sev(b) - sev(a) || (a.close_date ?? "").localeCompare(b.close_date ?? ""));
  return { asOf, columns: COLUMNS, cards, rejected: s.raw.filter((r) => r.status === "rejected").length };
}
