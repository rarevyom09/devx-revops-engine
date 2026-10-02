// Leak engine: one rule set across the whole flow, producing a ranked
// exceptions inbox. Pure (no DB/server imports). No AI: these are money rules
// and must be deterministic and explainable.
import type { InvoiceClawback } from "./clawback";
import type { MarginResult } from "./margin";
import { WARNING_MARGIN_PCT } from "./margin";

export type Stage = "deal" | "booking" | "invoice" | "cash" | "margin";
export type Severity = "critical" | "warning" | "info";

export type Alert = {
  id: string;
  stage: Stage;
  severity: Severity;
  title: string;
  subject: string; // deal / invoice the alert is about
  detail: string; // why, with the numbers
  impact: number | null; // INR at stake, if quantifiable
  action: string; // what a human should do
  href: string;
  ref: AlertRef; // record the alert is attributed to
};

// raw = a raw deal (pre-approval); deal/invoice carry the approved deal's id.
export type AlertRef = { kind: "raw" | "deal" | "invoice"; id: string; deal_id: string | null };

export type RawDealIn = {
  id: string;
  raw_text: string;
  status: "pending" | "analysed" | "approved" | "rejected";
  analysis: { confidence: string; flags: number; ambiguities: number; is_blended: boolean } | null;
};

export type DealIn = {
  id: string;
  name: string;
  deal_type: "one_time" | "recurring";
  amount: number;
  term_months: number | null;
  close_date: string;
  total: number;
  practice_split: Record<string, number> | null;
  partner: string | null;
  partner_flags: { deal_registered?: boolean | null; mdf_amount?: number | null } | null;
  brief_status: "none" | "draft" | "approved";
  scheduled_invoice_total: number; // all invoice rows, raised or future-dated
};

export type MarginIn = MarginResult & { deal_id: string; name: string };
export type InvoiceIn = InvoiceClawback & { deal_id?: string | null };

export const RENEWAL_WINDOW_DAYS = 90;
export const URGENT_DAYS = 30;

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const snippet = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

function addMonths(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function findLeaks(input: {
  today: string;
  rawDeals: RawDealIn[];
  deals: DealIn[];
  invoices: InvoiceIn[];
  margins: MarginIn[];
}): Alert[] {
  const { today } = input;
  const out: Alert[] = [];
  let ref: AlertRef = { kind: "raw", id: "", deal_id: null };
  const push = (a: Omit<Alert, "ref">) => out.push({ ...a, ref });

  // 1. Deal integrity: bad records here corrupt every later stage.
  for (const r of input.rawDeals) {
    if (r.status !== "pending" && r.status !== "analysed") continue;
    ref = { kind: "raw", id: r.id, deal_id: null };
    const subject = snippet(r.raw_text);
    if (!r.analysis) {
      push({
        id: `deal-unreviewed-${r.id}`, stage: "deal", severity: "info", subject,
        title: "Deal not yet checked",
        detail: "Raw deal text has not been through the integrity agent; type, split and dates are unverified.",
        impact: null, action: "Analyse with AI", href: "/pipeline",
      });
      continue;
    }
    const a = r.analysis;
    if (a.flags > 0 || a.confidence === "low") {
      push({
        id: `deal-flags-${r.id}`, stage: "deal", severity: "warning", subject,
        title: a.flags > 0 ? `${a.flags} integrity check${a.flags === 1 ? "" : "s"} failed` : "Low-confidence analysis",
        detail: `Amounts, dates or types don't reconcile with the rep's text${a.ambiguities ? `; ${a.ambiguities} open question(s) for the rep` : ""}. Approving as-is would push bad data into forecast, invoicing and clawback.`,
        impact: null, action: "Review, fix, then approve", href: "/pipeline",
      });
    } else if (a.is_blended) {
      push({
        id: `deal-blended-${r.id}`, stage: "deal", severity: "warning", subject,
        title: "Blended deal awaiting split",
        detail: "One-time and recurring revenue are mixed in one description. Until split, one-time vs ARR forecast is wrong.",
        impact: null, action: "Approve the proposed split", href: "/pipeline",
      });
    } else {
      push({
        id: `deal-ready-${r.id}`, stage: "deal", severity: "info", subject,
        title: "Analysed, awaiting approval",
        detail: `Checks passed (${a.confidence} confidence)${a.ambiguities ? `; ${a.ambiguities} question(s) to confirm` : ""}.`,
        impact: null, action: "Approve", href: "/pipeline",
      });
    }
  }

  // 2. Booking -> handoff, attribution, partner, renewal.
  for (const d of input.deals) {
    ref = { kind: "deal", id: d.id, deal_id: d.id };
    const billed = d.scheduled_invoice_total;
    if (d.brief_status !== "approved" && billed === 0) {
      const late = d.deal_type === "one_time" ? d.close_date < today : false;
      push({
        id: `booking-noplan-${d.id}`, stage: "booking", severity: late ? "critical" : "warning", subject: d.name,
        title: "Booked with no billing plan",
        detail: `${inr(d.total)} contracted but no approved milestones, so nothing will be invoiced (and no variable pay earned).${late ? " Project end date has already passed." : ""}`,
        impact: d.total, action: "Draft and approve onboarding brief", href: "/onboarding",
      });
    }

    const split = d.practice_split ? Object.values(d.practice_split) : [];
    const sum = split.reduce((s, x) => s + Number(x), 0);
    if (split.length === 0 || Math.abs(sum - 1) > 0.001) {
      push({
        id: `booking-attrib-${d.id}`, stage: "booking", severity: "warning", subject: d.name,
        title: "No practice attribution",
        detail: split.length === 0
          ? "Consulting owner gets 100% credit, but no practice-team split is recorded, so the practice side of the double bubble can't be paid."
          : `Practice split sums to ${Math.round(sum * 100)}%, not 100%.`,
        impact: null, action: "Set practice split", href: "/pipeline",
      });
    }

    if (d.partner) {
      const reg = d.partner_flags?.deal_registered;
      if (reg !== true) {
        push({
          id: `booking-partner-${d.id}`, stage: "booking", severity: "warning", subject: d.name,
          title: `${d.partner} deal not registered`,
          detail: `Partner involvement recorded but deal registration is ${reg === false ? "missing" : "unconfirmed"}; partner attribution and any co-sell benefits are at risk.`,
          impact: null, action: "Confirm deal registration with partner team", href: "/pipeline",
        });
      }
      const mdf = d.partner_flags?.mdf_amount;
      if (mdf) {
        push({
          id: `booking-mdf-${d.id}`, stage: "booking", severity: "info", subject: d.name,
          title: `${inr(mdf)} MDF to claim`,
          detail: "MDF is partner funding, not revenue. Claim and reconciliation happen outside this tool (stubbed).",
          impact: mdf, action: "Track MDF claim", href: "/honesty",
        });
      }
    }

    if (d.deal_type === "recurring" && d.term_months) {
      const end = addMonths(d.close_date, d.term_months);
      const left = days(today, end);
      if (left >= 0 && left <= RENEWAL_WINDOW_DAYS) {
        push({
          id: `booking-renewal-${d.id}`, stage: "booking", severity: left <= URGENT_DAYS ? "critical" : "warning", subject: d.name,
          title: `Renewal due in ${left} days`,
          detail: `Contract ends ${end}. ${inr(d.amount * 12)} annualised recurring revenue lapses without a renewal.`,
          impact: d.amount * 12, action: "Start renewal conversation", href: "/onboarding",
        });
      }
    }

    // 3. Invoice coverage.
    if (billed > 0 && billed < d.total - 1) {
      push({
        id: `invoice-gap-${d.id}`, stage: "invoice", severity: "warning", subject: d.name,
        title: "Contract not fully scheduled for invoicing",
        detail: `${inr(billed)} invoiced or scheduled against ${inr(d.total)} contracted.`,
        impact: d.total - billed, action: "Add missing milestones", href: "/onboarding",
      });
    } else if (billed > d.total + 1) {
      push({
        id: `invoice-over-${d.id}`, stage: "invoice", severity: "critical", subject: d.name,
        title: "Invoiced more than contracted",
        detail: `${inr(billed)} invoiced against ${inr(d.total)} contracted. Check for duplicate or out-of-scope invoices.`,
        impact: billed - d.total, action: "Reconcile invoices", href: "/clawback",
      });
    }
  }

  // 4. Realization and clawback.
  for (const i of input.invoices) {
    ref = { kind: "invoice", id: i.id, deal_id: i.deal_id ?? null };
    const subject = `${i.deal_name ?? "Deal"} · ${i.milestone}`;
    if (i.status === "overdue_exposure") {
      push({
        id: `cash-clawback-${i.id}`, stage: "cash", severity: "critical", subject,
        title: `${inr(i.realised_clawback)} variable pay clawed back`,
        detail: `Deadline ${i.deadline} passed with ${inr(i.paid_by_deadline)} of ${inr(i.amount)} paid. ${i.owner_name ?? "Owner"} loses ${Math.round((1 - i.paid_by_deadline / i.amount) * 100)}% of the variable pay on this invoice.`,
        impact: i.realised_clawback, action: "Notify owner and finance", href: "/clawback",
      });
    } else if (i.status === "at_risk") {
      push({
        id: `cash-risk-${i.id}`, stage: "cash", severity: i.days_left <= URGENT_DAYS ? "critical" : "warning", subject,
        title: `Clawback risk: ${i.days_left} days to deadline`,
        detail: `${inr(i.outstanding)} outstanding; if unpaid by ${i.deadline}, ${i.owner_name ?? "the owner"} loses ${inr(i.projected_exposure)} variable pay.`,
        impact: i.projected_exposure, action: "Chase payment now", href: "/clawback",
      });
    } else if (i.status === "partial") {
      push({
        id: `cash-partial-${i.id}`, stage: "cash", severity: "info", subject,
        title: "Partially paid",
        detail: `${inr(i.outstanding)} outstanding; ${i.days_left} days to ${i.deadline}. Exposure if nothing more lands: ${inr(i.projected_exposure)}.`,
        impact: i.projected_exposure, action: "Monitor", href: "/clawback",
      });
    }
  }

  // 5. Margin.
  for (const m of input.margins) {
    ref = { kind: "deal", id: m.deal_id, deal_id: m.deal_id };
    const deal = input.deals.find((d) => d.id === m.deal_id);
    if (m.status === "no_hours") {
      if (deal && deal.scheduled_invoice_total > 0) {
        push({
          id: `margin-blind-${m.deal_id}`, stage: "margin", severity: "info", subject: m.name,
          title: "Billing but no effort logged",
          detail: "Invoices exist but no timesheet hours, so margin is invisible.",
          impact: null, action: "Ensure delivery team logs hours", href: "/margin",
        });
      }
      continue;
    }
    const pct = m.margin_pct ?? 0;
    if (m.status === "warning") {
      push({
        id: `margin-floor-${m.deal_id}`, stage: "margin", severity: "critical", subject: m.name,
        title: `Margin ${(pct * 100).toFixed(1)}%, below ${WARNING_MARGIN_PCT * 100}% floor`,
        detail: `${inr(m.cost)} cost on ${inr(m.price)} price (${m.hours.IN}h IN + ${m.hours.SG}h SG). Scope creep or wrong IN/SG mix.`,
        impact: Math.max(0, WARNING_MARGIN_PCT * m.price - (m.margin ?? 0)),
        action: "Review scope, raise change request", href: "/margin",
      });
    } else if (m.status === "below_target") {
      push({
        id: `margin-target-${m.deal_id}`, stage: "margin", severity: "warning", subject: m.name,
        title: `Margin ${(pct * 100).toFixed(1)}%, below target`,
        detail: `Eroded ${((m.erosion_pct ?? 0) * 100).toFixed(1)} points from target.`,
        impact: null, action: "Watch hours", href: "/margin",
      });
    }
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impact ?? 0) - (a.impact ?? 0));
}
