// "Double bubble" attribution: every invoiced rupee credits the consulting
// owner 100% AND the practice team(s) by their pillar split, so total credit is
// ~2x invoiced on purpose. Pure: no DB/server imports.
import type { InvoiceClawback } from "./clawback";

export type AttributionDeal = { id: string; name: string; owner_name: string | null; practice_split: Record<string, number> | null };
export type AttributionInvoice = InvoiceClawback & { deal_id: string };

type Credit = {
  invoiced: number; // raised on or before as-of: the variable-pay metric
  collected: number;
  at_stake: number; // variable pay riding on those invoices
  realised_clawback: number;
  projected_exposure: number;
};
const zero = (): Credit => ({ invoiced: 0, collected: 0, at_stake: 0, realised_clawback: 0, projected_exposure: 0 });

function add(c: Credit, inv: AttributionInvoice, share: number) {
  c.invoiced += inv.amount * share;
  c.collected += (inv.paid_by_deadline + inv.paid_after_deadline) * share;
  c.at_stake += (inv.variable_pay_at_stake ?? 0) * share;
  c.realised_clawback += inv.realised_clawback * share;
  c.projected_exposure += inv.projected_exposure * share;
}

export function attribute(deals: AttributionDeal[], invoices: AttributionInvoice[], asOf: string) {
  const owners = new Map<string, Credit>();
  const practices = new Map<string, Credit>();
  const unattributed = zero();
  const unattributedDeals = new Set<string>();
  const perDeal = new Map<string, { owner: string; practices: Record<string, number>; invoiced: number }>();

  for (const inv of invoices) {
    if (inv.raised_on > asOf) continue; // scheduled, not yet invoiced
    const deal = deals.find((d) => d.id === inv.deal_id);
    if (!deal) continue;
    const owner = deal.owner_name ?? "Unassigned";
    if (!owners.has(owner)) owners.set(owner, zero());
    add(owners.get(owner)!, inv, 1); // bubble 1: consulting owner, always 100%

    const split = Object.entries(deal.practice_split ?? {}).filter(([, v]) => v > 0);
    const total = split.reduce((x, [, v]) => x + v, 0);
    const d = perDeal.get(deal.id) ?? { owner, practices: {}, invoiced: 0 };
    d.invoiced += inv.amount;
    if (!split.length || Math.abs(total - 1) > 0.001) {
      add(unattributed, inv, 1); // bubble 2 is missing: practice can't be paid
      unattributedDeals.add(deal.name);
    } else {
      for (const [p, share] of split) {
        if (!practices.has(p)) practices.set(p, zero());
        add(practices.get(p)!, inv, share); // bubble 2: practice teams by pillar split
        d.practices[p] = (d.practices[p] ?? 0) + inv.amount * share;
      }
    }
    perDeal.set(deal.id, d);
  }

  const sum = (m: Map<string, Credit>) => [...m.values()].reduce((x, c) => x + c.invoiced, 0);
  const invoiced = sum(owners);
  return {
    owners: [...owners].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.invoiced - a.invoiced),
    practices: [...practices].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.invoiced - a.invoiced),
    unattributed: { ...unattributed, deals: [...unattributedDeals] },
    perDeal: Object.fromEntries(perDeal),
    totals: {
      invoiced,
      ownerCredit: invoiced,
      practiceCredit: sum(practices),
      totalCredit: invoiced + sum(practices), // the "double bubble"
    },
  };
}
