// In-memory validation of the demo seed. No DB access.
// Run: npx tsx scripts/check-seed.ts
import { DEMO_TODAY, evaluateAll, rollupByOwner, type InvoiceInput } from "../src/lib/clawback";
import { computeMargin, dealPrice, sumHours, type Rates } from "../src/lib/margin";
import { findLeaks, type DealIn, type RawDealIn } from "../src/lib/leaks";
import { attribute } from "../src/lib/attribution";
import { dealTotal, VARIABLE_PAY_RATE } from "../src/lib/onboarding-validate";
import { NAME_PATTERN, extractAmounts } from "../src/lib/integrity";
import {
  deals, invoices, onboardingBriefs, payments, people, rates, rawDeals, timesheets,
  SEED_ORDER, RESET_ORDER,
} from "../src/lib/demo-data";

const asOf = DEMO_TODAY;
const errors: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

// ---------- structural checks ----------
const uniq = <T,>(xs: T[], label: string) => {
  const seen = new Set<T>();
  for (const x of xs) { check(!seen.has(x), `duplicate ${label}: ${String(x)}`); seen.add(x); }
};
const allIds = [people, rawDeals, deals, onboardingBriefs, invoices, payments, timesheets].flatMap((t) => t.map((r) => r.id));
uniq(allIds, "id (across tables)");
check(!allIds.some((x) => x.startsWith("88888888")), "seed uses the 88888888 prefix reserved for Try cases");
uniq(people.map((p) => p.name), "people.name");
uniq(deals.map((d) => d.name), "deals.name");
uniq(invoices.map((i) => `${i.deal_id}|${i.milestone}`), "invoice (deal_id, milestone)");

const personIds = new Set(people.map((p) => p.id));
const dealIds = new Set(deals.map((d) => d.id));
const invoiceIds = new Set(invoices.map((i) => i.id));
const rateLocs = new Set(rates.map((r) => r.location));
const rawIds = new Set(rawDeals.map((r) => r.id));
for (const r of rawDeals) check(personIds.has(r.owner_id), `raw ${r.id}: unknown owner`);
for (const d of deals) {
  check(personIds.has(d.owner_id), `${d.name}: unknown owner`);
  check(d.raw_deal_id == null || rawIds.has(d.raw_deal_id), `${d.name}: unknown raw_deal_id`);
  check(NAME_PATTERN.test(d.name), `${d.name}: name doesn't follow "<Client> - <Scope>"`);
  check((d.deal_type === "recurring") === (d.term_months != null && d.term_months > 0), `${d.name}: recurring ⇔ term_months violated`);
  check(d.amount > 0, `${d.name}: amount must be > 0`);
  if (d.practice_split) {
    const s = Object.values(d.practice_split).reduce((a, b) => a + b, 0);
    check(Math.abs(s - 1) < 0.001, `${d.name}: practice split sums to ${s}`);
  }
}
for (const b of onboardingBriefs) check(dealIds.has(b.deal_id), `brief ${b.id}: unknown deal`);
for (const i of invoices) {
  check(dealIds.has(i.deal_id), `invoice ${i.id}: unknown deal`);
  check(personIds.has(i.owner_id), `invoice ${i.id}: unknown owner`);
  check(i.amount > 0, `invoice ${i.id}: amount must be > 0`);
  check(i.variable_pay_at_stake === Math.round(i.amount * VARIABLE_PAY_RATE), `invoice ${i.milestone}: at-stake isn't 5%`);
  const d = deals.find((x) => x.id === i.deal_id);
  check(d?.owner_id === i.owner_id, `invoice ${i.milestone}: owner differs from deal owner`);
}
for (const p of payments) {
  check(invoiceIds.has(p.invoice_id), `payment ${p.id}: unknown invoice`);
  check(p.paid_on <= asOf, `payment ${p.id}: dated after demo today`);
  const inv = invoices.find((i) => i.id === p.invoice_id)!;
  check(p.paid_on >= inv.raised_on, `payment ${p.id}: paid before invoice raised`);
}
for (const i of invoices) {
  const paid = payments.filter((p) => p.invoice_id === i.id).reduce((s, p) => s + p.amount, 0);
  check(paid <= i.amount, `invoice ${i.milestone}: overpaid`);
}
for (const t of timesheets) {
  check(dealIds.has(t.deal_id), `timesheet ${t.id}: unknown deal`);
  check(rateLocs.has(t.location), `timesheet ${t.id}: unknown location`);
  check(t.hours > 0, `timesheet ${t.id}: hours must be > 0`);
  check(t.logged_on <= asOf, `timesheet ${t.id}: logged in the future`);
}

// Invoices sum exactly to the deal total.
for (const d of deals) {
  const billed = invoices.filter((i) => i.deal_id === d.id).reduce((s, i) => s + i.amount, 0);
  check(billed === dealTotal(d), `${d.name}: invoices ${inr(billed)} ≠ total ${inr(dealTotal(d))}`);
}

// Briefs: approved, milestones consistent with deal and invoices.
for (const b of onboardingBriefs) {
  const d = deals.find((x) => x.id === b.deal_id)!;
  const ms = b.milestones;
  const sum = ms.reduce((s, m) => s + m.pct, 0);
  check(Math.abs(sum - 100) <= 0.01, `${d.name}: milestone pct sums to ${sum}`);
  for (let k = 1; k < ms.length; k++) check(ms[k].due_date >= ms[k - 1].due_date, `${d.name}: milestones out of order`);
  if (d.deal_type === "one_time") check(ms.every((m) => m.due_date <= d.close_date), `${d.name}: milestone after project end`);
  else check(ms.length === d.term_months && ms[0].due_date === d.close_date, `${d.name}: monthly schedule doesn't match term/first billing`);
  const invs = invoices.filter((i) => i.deal_id === d.id);
  check(invs.length === ms.length && ms.every((m) => invs.some((i) => i.milestone === m.name && i.raised_on === m.due_date)),
    `${d.name}: invoices don't match approved milestones`);
  check(b.status === "approved" && !!b.approved_by && !!b.approved_at, `${d.name}: brief not approved`);
  const br = b.brief;
  check(!!br.scope_summary && br.deliverables.length > 0 && br.success_criteria.length > 0 && br.source === "seed", `${d.name}: brief incomplete`);
  check(b.approved_at >= d.approved_at, `${d.name}: brief approved before deal`);
}
check(deals.filter((d) => !d.practice_split).length === 1, "exactly one deal should be missing practice_split");

// Raw deals: every ₹ amount parses.
for (const r of rawDeals) check(extractAmounts(r.raw_text).length > 0, `raw ${r.id}: no ₹ amount parsed`);

// Seed/reset order.
const seedTables = SEED_ORDER.map(([t]) => t);
check(seedTables.indexOf("onboarding_briefs") > seedTables.indexOf("deals") && seedTables.indexOf("onboarding_briefs") < seedTables.indexOf("invoices"), "SEED_ORDER: briefs must sit between deals and invoices");
check(RESET_ORDER[0] === "action_drafts" && RESET_ORDER[1] === "notifications", "RESET_ORDER must start with action_drafts, notifications");

// ---------- rule engines ----------
const names = new Map(people.map((p) => [p.id, p.name]));
const dealName = new Map(deals.map((d) => [d.id, d.name]));
const invIn: InvoiceInput[] = invoices.map((i) => ({
  id: i.id, milestone: i.milestone, amount: i.amount, raised_on: i.raised_on, owner_id: i.owner_id,
  variable_pay_at_stake: i.variable_pay_at_stake, deal_name: dealName.get(i.deal_id) ?? null, owner_name: names.get(i.owner_id) ?? null,
}));
const evals = evaluateAll(invIn, payments, asOf).map((e) => ({ ...e, deal_id: invoices.find((i) => i.id === e.id)!.deal_id }));
const rateMap: Rates = { IN: 0, SG: 0 };
for (const r of rates) rateMap[r.location as "IN" | "SG"] = r.hourly_rate;
const margins = deals.map((d) => ({ deal_id: d.id, name: d.name, ...computeMargin(d, sumHours(timesheets.filter((t) => t.deal_id === d.id)), rateMap) }));

const alerts = findLeaks({
  today: asOf,
  rawDeals: rawDeals.map((r): RawDealIn => ({ id: r.id, raw_text: r.raw_text, status: "pending", analysis: null })),
  deals: deals.map((d): DealIn => ({
    id: d.id, name: d.name, deal_type: d.deal_type, amount: d.amount, term_months: d.term_months, close_date: d.close_date,
    total: dealPrice(d).price, practice_split: d.practice_split, partner: d.partner, partner_flags: d.partner_flags,
    brief_status: onboardingBriefs.some((b) => b.deal_id === d.id && b.status === "approved") ? "approved" : "none",
    scheduled_invoice_total: invoices.filter((i) => i.deal_id === d.id).reduce((s, i) => s + i.amount, 0),
  })),
  invoices: evals,
  margins,
});

const attr = attribute(
  deals.map((d) => ({ id: d.id, name: d.name, owner_name: names.get(d.owner_id) ?? null, practice_split: d.practice_split })),
  evals,
  asOf,
);

// Picture checks: realistic, not a wall of red.
const crit = alerts.filter((a) => a.severity === "critical");
const titles = alerts.map((a) => a.title);
check(crit.length <= 3, `too many critical alerts (${crit.length})`);
check(alerts.filter((a) => a.id.startsWith("cash-clawback")).length === 1, "expected exactly one realised clawback (Hooli)");
check(alerts.filter((a) => a.id.startsWith("margin-floor")).length === 1, "expected exactly one margin floor breach (Wayne)");
check(alerts.filter((a) => a.id.startsWith("booking-renewal")).length === 1, "expected exactly one renewal alert");
check(alerts.filter((a) => a.id.startsWith("booking-attrib")).length === 1, "expected exactly one missing practice split");
check(alerts.filter((a) => a.id.startsWith("booking-partner")).length === 1, "expected exactly one unregistered partner deal");
check(alerts.filter((a) => a.id.startsWith("margin-target")).length === 1, "expected exactly one below-target margin");
check(!alerts.some((a) => a.id.startsWith("invoice-") || a.id.startsWith("booking-noplan") || a.id.startsWith("margin-blind")), "unexpected invoice/no-plan/no-hours alerts");
check(evals.filter((e) => e.status === "partial").length >= 2, "expected a couple of partial payments");

// ---------- summary ----------
const entityOf = (d: (typeof deals)[number]) => people.find((p) => p.id === d.owner_id)!.entity;
const tally = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
console.log(`Seed as of ${asOf}`);
console.log(`  people ${people.length} · raw deals ${rawDeals.length} · deals ${deals.length} · briefs ${onboardingBriefs.length} · invoices ${invoices.length} · payments ${payments.length} · timesheets ${timesheets.length}`);
console.log(`  deals by entity`, tally(deals.map(entityOf)));
console.log(`  deals by type  `, tally(deals.map((d) => d.deal_type)));
console.log(`  deals by practice (any share)`, tally(deals.flatMap((d) => Object.keys(d.practice_split ?? { "(none)": 1 }))));
console.log(`  partner deals  `, deals.filter((d) => d.partner).map((d) => `${d.name} [${d.partner}, reg=${d.partner_flags?.deal_registered}${d.partner_flags?.mdf_amount ? `, MDF ${inr(d.partner_flags.mdf_amount)}` : ""}]`));

const booked = deals.reduce((s, d) => s + dealTotal(d), 0);
const raised = invoices.filter((i) => i.raised_on <= asOf);
const scheduled = invoices.filter((i) => i.raised_on > asOf);
const collected = payments.filter((p) => p.paid_on <= asOf).reduce((s, p) => s + p.amount, 0);
console.log(`\nMoney`);
console.log(`  booked ${inr(booked)} · invoiced ${inr(raised.reduce((s, i) => s + i.amount, 0))} (${raised.length}) · scheduled ${inr(scheduled.reduce((s, i) => s + i.amount, 0))} (${scheduled.length}) · collected ${inr(collected)}`);
console.log(`  invoice status`, tally(evals.map((e) => e.status)));
for (const o of rollupByOwner(evals)) console.log(`  ${o.owner_name.padEnd(14)} at stake ${inr(o.at_stake).padStart(10)} · clawed ${inr(o.realised_clawback).padStart(8)} · exposure ${inr(o.projected_exposure)}`);

console.log(`\nAlerts (${alerts.length}): ${crit.length} critical, ${alerts.filter((a) => a.severity === "warning").length} warning, ${alerts.filter((a) => a.severity === "info").length} info`);
for (const a of alerts) if (!a.id.startsWith("deal-unreviewed")) console.log(`  [${a.severity}] ${a.stage.padEnd(7)} ${a.title} — ${a.subject}`);
console.log(`  [info] deal    Deal not yet checked × ${titles.filter((t) => t === "Deal not yet checked").length}`);

console.log(`\nMargins`);
for (const m of margins) console.log(`  ${pct(m.margin_pct).padStart(6)}  ${m.status.padEnd(12)} ${m.name}  (${m.hours.IN}h IN / ${m.hours.SG}h SG, cost ${inr(m.cost)} on ${inr(m.price)})`);

console.log(`\nAttribution (invoiced to date)`);
console.log(`  owners:   `, attr.owners.map((o) => `${o.name} ${inr(o.invoiced)}`).join(" · "));
console.log(`  practices:`, attr.practices.map((p) => `${p.name} ${inr(p.invoiced)}`).join(" · "));
console.log(`  unattributed ${inr(attr.unattributed.invoiced)} (${attr.unattributed.deals.join(", ")})`);
console.log(`  totals: invoiced ${inr(attr.totals.invoiced)} · practice credit ${inr(attr.totals.practiceCredit)} · total credit ${inr(attr.totals.totalCredit)}`);

if (errors.length) {
  console.error(`\n${errors.length} check(s) FAILED:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`\nAll seed checks passed.`);
