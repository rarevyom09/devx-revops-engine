// Clawback rules (HANDOFF §2, §11). Pure functions: no DB, no server imports.

// Month (1-12) the year's first quarter starts in. 1 = calendar quarters (assumed).
// Indian FY would be 4 (Apr-Mar). Note: FY quarters cover the same 3-month blocks
// as calendar quarters, so deadlines are identical; only the quarter label changes.
export const QUARTER_START_MONTH = 1;
export const AT_RISK_WINDOW_DAYS = 60;
export const DEMO_TODAY = "2026-10-02";
export const QUARTER_ASSUMPTION =
  QUARTER_START_MONTH === 1 ? "Calendar quarters (Jan-Mar = Q1)" : `Fiscal quarters starting month ${QUARTER_START_MONTH}`;

export type ClawbackStatus = "safe" | "overdue_exposure" | "at_risk" | "partial" | "open";

export type InvoiceInput = {
  id: string;
  deal_name: string | null;
  milestone: string;
  amount: number;
  raised_on: string;
  owner_id: string | null;
  owner_name: string | null;
  variable_pay_at_stake: number | null;
};

export type PaymentInput = { invoice_id: string; amount: number; paid_on: string };

export type InvoiceClawback = InvoiceInput & {
  quarter: string;
  deadline: string;
  days_left: number;
  paid_by_deadline: number;
  paid_after_deadline: number;
  outstanding: number;
  status: ClawbackStatus;
  realised_clawback: number;
  projected_exposure: number;
};

export type OwnerRollup = {
  owner_id: string | null;
  owner_name: string;
  invoices: number;
  at_stake: number;
  realised_clawback: number;
  projected_exposure: number;
};

const DAY = 86_400_000;
const toUTC = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The single place quarter math lives.
export function quarterOf(iso: string) {
  const d = new Date(toUTC(iso));
  const offset = (d.getUTCMonth() - (QUARTER_START_MONTH - 1) + 12) % 12;
  const q = Math.floor(offset / 3);
  const startMonth = d.getUTCMonth() - (offset % 3);
  return { q: q + 1, year: d.getUTCFullYear(), startMonth, label: `Q${q + 1} ${d.getUTCFullYear()}` };
}

// Last day of the quarter following the one `raisedOn` falls in.
export function realizationDeadline(raisedOn: string): string {
  const { year, startMonth } = quarterOf(raisedOn);
  return toISO(Date.UTC(year, startMonth + 6, 0));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUTC(toIso) - toUTC(fromIso)) / DAY);
}

const round = (n: number) => Math.round(n * 100) / 100;

export function clawbackFor(atStake: number, amount: number, paid: number): number {
  if (amount <= 0) return 0;
  return round(Math.max(0, atStake * (1 - Math.min(1, paid / amount))));
}

// Status precedence (first match wins):
// 1 safe: fully paid by deadline (regardless of asOf)
// 2 overdue_exposure: deadline passed, not fully paid by it -> clawback realised
// 3 at_risk: deadline within AT_RISK_WINDOW_DAYS of asOf
// 4 partial: some payment received, deadline further out
// 5 open: nothing paid, deadline further out
// Payments dated after asOf are ignored (not yet known on that date).
export function evaluateInvoice(inv: InvoiceInput, payments: PaymentInput[], asOf: string): InvoiceClawback {
  const deadline = realizationDeadline(inv.raised_on);
  const known = payments.filter((p) => p.invoice_id === inv.id && p.paid_on <= asOf);
  const paidByDeadline = round(known.filter((p) => p.paid_on <= deadline).reduce((s, p) => s + Number(p.amount), 0));
  const paidAfter = round(known.filter((p) => p.paid_on > deadline).reduce((s, p) => s + Number(p.amount), 0));
  const amount = Number(inv.amount);
  const atStake = Number(inv.variable_pay_at_stake ?? 0);
  const daysLeft = daysBetween(asOf, deadline);
  const fullyPaid = paidByDeadline >= amount;
  const passed = daysLeft < 0;

  const status: ClawbackStatus = fullyPaid
    ? "safe"
    : passed
      ? "overdue_exposure"
      : daysLeft <= AT_RISK_WINDOW_DAYS
        ? "at_risk"
        : paidByDeadline > 0
          ? "partial"
          : "open";

  // If nothing more is paid before the deadline, this is what gets clawed back.
  const exposure = clawbackFor(atStake, amount, paidByDeadline);
  return {
    ...inv,
    amount,
    variable_pay_at_stake: atStake,
    quarter: quarterOf(inv.raised_on).label,
    deadline,
    days_left: daysLeft,
    paid_by_deadline: paidByDeadline,
    paid_after_deadline: paidAfter,
    outstanding: round(Math.max(0, amount - paidByDeadline - paidAfter)),
    status,
    realised_clawback: status === "overdue_exposure" ? exposure : 0,
    projected_exposure: status === "safe" || status === "overdue_exposure" ? 0 : exposure,
  };
}

export function evaluateAll(invoices: InvoiceInput[], payments: PaymentInput[], asOf: string): InvoiceClawback[] {
  return invoices
    .filter((i) => i.raised_on <= asOf)
    .map((i) => evaluateInvoice(i, payments, asOf))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.raised_on.localeCompare(b.raised_on));
}

export function rollupByOwner(rows: InvoiceClawback[]): OwnerRollup[] {
  const map = new Map<string, OwnerRollup>();
  for (const r of rows) {
    const key = r.owner_id ?? "unassigned";
    const o = map.get(key) ?? {
      owner_id: r.owner_id,
      owner_name: r.owner_name ?? "Unassigned",
      invoices: 0,
      at_stake: 0,
      realised_clawback: 0,
      projected_exposure: 0,
    };
    o.invoices += 1;
    o.at_stake = round(o.at_stake + Number(r.variable_pay_at_stake ?? 0));
    o.realised_clawback = round(o.realised_clawback + r.realised_clawback);
    o.projected_exposure = round(o.projected_exposure + r.projected_exposure);
    map.set(key, o);
  }
  return [...map.values()].sort((a, b) => b.realised_clawback + b.projected_exposure - (a.realised_clawback + a.projected_exposure));
}

export function isISODate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s));
}
