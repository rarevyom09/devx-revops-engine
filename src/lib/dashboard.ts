// Dashboard aggregation. Pure (no DB/server imports) so the page can re-slice
// the same payload client-side when filters change.
import { quarterOf, type ClawbackStatus } from "./clawback";
import type { Severity, Stage } from "./leaks";
import { WARNING_MARGIN_PCT, type MarginStatus } from "./margin";

export type Entity = "IN" | "SG";
export type DealType = "one_time" | "recurring";

export type DashDeal = {
  id: string;
  name: string;
  deal_type: DealType;
  amount: number;
  term_months: number | null;
  total: number;
  arr: number | null; // recurring only: monthly x 12
  close_date: string;
  owner_id: string | null;
  owner: string | null;
  entity: Entity | null;
  practices: string[];
};
export type DashInvoice = {
  id: string;
  deal_id: string;
  deal: string;
  milestone: string;
  amount: number;
  raised_on: string;
  raised: boolean;
  owner_id: string | null;
  owner: string | null;
  paid_to_date: number;
  status: ClawbackStatus | null; // null = scheduled (raised after asOf)
  deadline: string | null;
  days_left: number | null;
  at_stake: number;
  realised: number;
  projected: number;
};
export type DashPayment = { invoice_id: string; deal_id: string; amount: number; paid_on: string };
export type DashMargin = {
  deal_id: string;
  name: string;
  price: number;
  hours: Record<Entity, number>;
  cost: number;
  blended_rate: number | null;
  margin_pct: number | null;
};
export type DashAlert = {
  id: string;
  stage: Stage;
  severity: Severity;
  title: string;
  subject: string;
  impact: number | null;
  href: string;
  deal_id: string | null;
  owner_id: string | null;
};
export type DashboardData = {
  asOf: string;
  owners: { id: string; name: string; entity: Entity | null }[];
  practices: string[];
  deals: DashDeal[];
  invoices: DashInvoice[];
  payments: DashPayment[]; // paid on or before asOf
  margins: DashMargin[];
  alerts: DashAlert[];
};

export type Filters = { owner: string; entity: "" | Entity; type: "" | DealType; practice: string };
export const NO_FILTERS: Filters = { owner: "", entity: "", type: "", practice: "" };
export const isFiltered = (f: Filters) => !!(f.owner || f.entity || f.type || f.practice);

export function applyFilters(d: DashboardData, f: Filters): DashboardData {
  const entityOf = new Map(d.owners.map((o) => [o.id, o.entity]));
  const ownerOk = (id: string | null) =>
    (!f.owner || id === f.owner) && (!f.entity || (!!id && entityOf.get(id) === f.entity));
  const deals = d.deals.filter(
    (x) => ownerOk(x.owner_id) && (!f.type || x.deal_type === f.type) && (!f.practice || x.practices.includes(f.practice)),
  );
  const ids = new Set(deals.map((x) => x.id));
  return {
    ...d,
    deals,
    invoices: d.invoices.filter((i) => ids.has(i.deal_id)),
    payments: d.payments.filter((p) => ids.has(p.deal_id)),
    margins: d.margins.filter((m) => ids.has(m.deal_id)),
    // Pre-approval alerts have no deal: they follow the owner filters only.
    alerts: d.alerts.filter((a) =>
      a.deal_id ? ids.has(a.deal_id) : !f.type && !f.practice && ownerOk(a.owner_id),
    ),
  };
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

export function kpis(d: DashboardData) {
  const raised = d.invoices.filter((i) => i.raised);
  return {
    contracted: sum(d.deals.map((x) => x.total)),
    invoiced: sum(raised.map((i) => i.amount)),
    collected: sum(d.payments.map((p) => p.amount)),
    realised: sum(raised.map((i) => i.realised)),
    projected: sum(raised.map((i) => i.projected)),
    critical: d.alerts.filter((a) => a.severity === "critical").length,
    deals: d.deals.length,
  };
}

export function dealMix(d: DashboardData) {
  const of = (t: DealType) => d.deals.filter((x) => x.deal_type === t);
  return {
    one_time: { count: of("one_time").length, value: sum(of("one_time").map((x) => x.total)) },
    recurring: {
      count: of("recurring").length,
      value: sum(of("recurring").map((x) => x.total)),
      arr: sum(of("recurring").map((x) => x.arr ?? 0)),
    },
  };
}

// Calendar quarters from the first invoice/payment through asOf.
export function byQuarter(d: DashboardData) {
  const map = new Map<string, { key: string; label: string; invoiced: number; collected: number }>();
  const slot = (iso: string) => {
    const q = quarterOf(iso);
    const key = `${q.year}-${q.q}`;
    if (!map.has(key)) map.set(key, { key, label: q.label, invoiced: 0, collected: 0 });
    return map.get(key)!;
  };
  for (const i of d.invoices) if (i.raised) slot(i.raised_on).invoiced += i.amount;
  for (const p of d.payments) slot(p.paid_on).collected += p.amount;
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function clawbackByOwner(d: DashboardData) {
  const map = new Map<string, { owner: string; realised: number; projected: number; at_stake: number }>();
  for (const i of d.invoices) {
    if (!i.raised) continue;
    const k = i.owner_id ?? "none";
    const o = map.get(k) ?? { owner: i.owner ?? "Unassigned", realised: 0, projected: 0, at_stake: 0 };
    o.realised += i.realised;
    o.projected += i.projected;
    o.at_stake += i.at_stake;
    map.set(k, o);
  }
  return [...map.values()].sort((a, b) => b.realised + b.projected - (a.realised + a.projected));
}

export type MarginBand = Exclude<MarginStatus, "no_hours">;
export function marginBand(pct: number, target: number): MarginBand {
  return pct < WARNING_MARGIN_PCT ? "warning" : pct < target ? "below_target" : "on_target";
}

export const STAGES: { key: Stage; label: string; href: string }[] = [
  { key: "deal", label: "Deal", href: "/pipeline" },
  { key: "booking", label: "Booking", href: "/onboarding" },
  { key: "invoice", label: "Invoice", href: "/clawback" },
  { key: "cash", label: "Realization", href: "/clawback" },
  { key: "margin", label: "Margin", href: "/margin" },
];

export function alertsByStage(d: DashboardData) {
  return STAGES.map((s) => {
    const mine = d.alerts.filter((a) => a.stage === s.key);
    const count = (k: Severity) => mine.filter((a) => a.severity === k).length;
    return { ...s, critical: count("critical"), warning: count("warning"), info: count("info"), alerts: mine };
  });
}
