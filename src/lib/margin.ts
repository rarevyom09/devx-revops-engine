// Margin rules (HANDOFF §2, §11). Pure functions: no DB, no server imports.

export const WARNING_MARGIN_PCT = 0.3;
export const DEFAULT_TARGET_MARGIN_PCT = 0.4;

export type Location = "IN" | "SG";
export type Rates = Record<Location, number>;
export type Hours = Record<Location, number>;

export type DealInput = {
  id: string;
  name: string;
  deal_type: "one_time" | "recurring";
  amount: number;
  term_months: number | null;
  owner_name: string | null;
};

export type MarginStatus = "no_hours" | "warning" | "below_target" | "on_target";

export type MarginResult = {
  price: number;
  price_basis: string;
  hours: Hours;
  total_hours: number;
  blended_rate: number | null;
  cost: number;
  pass_through: number;
  margin: number | null;
  margin_pct: number | null;
  erosion_pct: number | null;
  status: MarginStatus;
};

const round = (n: number) => Math.round(n * 100) / 100;

// Recurring deals: price = monthly amount x term (assumption, see UI).
export function dealPrice(d: Pick<DealInput, "deal_type" | "amount" | "term_months">) {
  const amount = Number(d.amount);
  if (d.deal_type === "recurring") {
    const term = Number(d.term_months ?? 0);
    return { price: amount * term, basis: `₹${amount.toLocaleString("en-IN")}/mo × ${term} months` };
  }
  return { price: amount, basis: "one-time amount" };
}

export function sumHours(rows: { location: string; hours: number }[]): Hours {
  const h: Hours = { IN: 0, SG: 0 };
  for (const r of rows) if (r.location === "IN" || r.location === "SG") h[r.location] += Number(r.hours);
  return h;
}

export function computeMargin(
  deal: Pick<DealInput, "deal_type" | "amount" | "term_months">,
  hours: Hours,
  rates: Rates,
  opts: { targetPct?: number; passThrough?: number } = {},
): MarginResult {
  const { price, basis } = dealPrice(deal);
  const target = opts.targetPct ?? DEFAULT_TARGET_MARGIN_PCT;
  const passThrough = opts.passThrough ?? 0;
  const total = hours.IN + hours.SG;
  const base = { price, price_basis: basis, hours, total_hours: total, pass_through: passThrough };
  if (total <= 0) {
    return { ...base, blended_rate: null, cost: 0, margin: null, margin_pct: null, erosion_pct: null, status: "no_hours" };
  }
  const blended = (hours.IN * rates.IN + hours.SG * rates.SG) / total;
  const cost = round(total * blended);
  const margin = round(price - cost - passThrough);
  const pct = price > 0 ? margin / price : 0;
  const status: MarginStatus = pct < WARNING_MARGIN_PCT ? "warning" : pct < target ? "below_target" : "on_target";
  return { ...base, blended_rate: round(blended), cost, margin, margin_pct: pct, erosion_pct: target - pct, status };
}
