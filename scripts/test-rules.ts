// Plain assertions for the rules modules. Run: npx tsx scripts/test-rules.ts
import assert from "node:assert/strict";
import { evaluateAll, evaluateInvoice, realizationDeadline, rollupByOwner, type InvoiceInput } from "../src/lib/clawback";
import { computeMargin, dealPrice, sumHours } from "../src/lib/margin";
import { formatINR } from "../src/lib/format";
import { deals, invoices, payments, people, rates as seedRates, timesheets } from "../src/lib/demo-data";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const names = new Map(people.map((p) => [p.id, p.name]));
const dealNames = new Map(deals.map((d) => [d.id, d.name]));
const inv: InvoiceInput[] = invoices.map((i) => ({
  ...i,
  deal_name: dealNames.get(i.deal_id) ?? null,
  owner_name: names.get(i.owner_id) ?? null,
}));
const byMilestone = (m: string) => inv.find((i) => i.milestone === m)!;

test("deadline: end of following calendar quarter", () => {
  assert.equal(realizationDeadline("2026-06-28"), "2026-09-30");
  assert.equal(realizationDeadline("2026-09-10"), "2026-12-31");
  assert.equal(realizationDeadline("2026-12-31"), "2027-03-31");
  assert.equal(realizationDeadline("2026-01-01"), "2026-06-30");
  assert.equal(realizationDeadline("2026-11-15"), "2027-03-31");
});

test("Hooli: 6L by deadline, 4L late -> overdue_exposure, clawback 20,000", () => {
  const r = evaluateInvoice(byMilestone("Final delivery 100%"), payments, "2026-10-02");
  assert.equal(r.deadline, "2026-09-30");
  assert.equal(r.days_left, -2);
  assert.equal(r.paid_by_deadline, 600000);
  assert.equal(r.paid_after_deadline, 400000);
  assert.equal(r.outstanding, 0);
  assert.equal(r.status, "overdue_exposure");
  assert.equal(r.realised_clawback, 20000);
  assert.equal(r.projected_exposure, 0);
});

test("Wayne Kickoff fully paid -> safe", () => {
  const r = evaluateInvoice(byMilestone("Kickoff 40%"), payments, "2026-10-02");
  assert.equal(r.status, "safe");
  assert.equal(r.realised_clawback + r.projected_exposure, 0);
});

test("Wayne UAT 1.5L of 4L -> partial now, at_risk on 15 Nov", () => {
  const now = evaluateInvoice(byMilestone("UAT 40%"), payments, "2026-10-02");
  assert.equal(now.status, "partial");
  assert.equal(now.days_left, 90);
  assert.equal(now.projected_exposure, 12500); // 20,000 x (1 - 1.5/4)
  const later = evaluateInvoice(byMilestone("UAT 40%"), payments, "2026-11-15");
  assert.equal(later.status, "at_risk");
  assert.equal(later.days_left, 46);
  const after = evaluateInvoice(byMilestone("UAT 40%"), payments, "2027-01-05");
  assert.equal(after.status, "overdue_exposure");
  assert.equal(after.realised_clawback, 12500);
});

test("Wayne Go-live unpaid -> open, full exposure", () => {
  const r = evaluateInvoice(byMilestone("Go-live 20%"), payments, "2026-10-02");
  assert.equal(r.status, "open");
  assert.equal(r.projected_exposure, 10000);
});

test("payments after asOf are ignored", () => {
  const r = evaluateInvoice(byMilestone("UAT 40%"), payments, "2026-09-30");
  assert.equal(r.paid_by_deadline, 0);
  assert.equal(r.status, "open");
});

test("overpayment floors clawback at 0", () => {
  const i = { ...byMilestone("Go-live 20%"), id: "x" };
  const r = evaluateInvoice(i, [{ invoice_id: "x", amount: 250000, paid_on: "2026-10-01" }], "2026-10-02");
  assert.equal(r.status, "safe");
  assert.equal(r.projected_exposure, 0);
});

test("owner roll-up", () => {
  const rows = evaluateAll(inv, payments, "2026-10-02");
  const roll = rollupByOwner(rows);
  const daniel = roll.find((o) => o.owner_name === "Daniel Tan")!;
  const priya = roll.find((o) => o.owner_name === "Priya Sharma")!;
  assert.deepEqual([daniel.at_stake, daniel.realised_clawback, daniel.projected_exposure], [50000, 20000, 0]);
  assert.deepEqual([priya.at_stake, priya.realised_clawback, priya.projected_exposure], [50000, 0, 22500]);
});

const rates = { IN: seedRates[0].hourly_rate, SG: seedRates[1].hourly_rate };
const hoursFor = (dealId: string) => sumHours(timesheets.filter((t) => t.deal_id === dealId));

test("Wayne margin 23.5% -> warning", () => {
  const wayne = deals.find((d) => d.name.startsWith("Wayne"))! as Parameters<typeof computeMargin>[0];
  const m = computeMargin(wayne, hoursFor(deals[0].id), rates);
  assert.deepEqual(m.hours, { IN: 220, SG: 50 });
  assert.equal(m.cost, 765000);
  assert.equal(m.margin, 235000);
  assert.equal(m.margin_pct, 0.235);
  assert.equal(m.status, "warning");
  assert.ok(Math.abs(m.erosion_pct! - 0.165) < 1e-9);
});

test("Hooli margin 48.75% -> on_target", () => {
  const hooli = deals.find((d) => d.name.startsWith("Hooli"))! as Parameters<typeof computeMargin>[0];
  const m = computeMargin(hooli, hoursFor(deals[1].id), rates);
  assert.equal(m.cost, 512500);
  assert.equal(m.margin_pct, 0.4875);
  assert.equal(m.status, "on_target");
});

test("no hours -> no_hours, not 100%", () => {
  const m = computeMargin({ deal_type: "one_time", amount: 800000, term_months: null }, { IN: 0, SG: 0 }, rates);
  assert.equal(m.status, "no_hours");
  assert.equal(m.margin_pct, null);
});

test("recurring price = monthly x term; what-if hours erode margin", () => {
  assert.equal(dealPrice({ deal_type: "recurring", amount: 50000, term_months: 12 }).price, 600000);
  const base = computeMargin({ deal_type: "one_time", amount: 1000000, term_months: null }, { IN: 160, SG: 30 }, rates);
  const creep = computeMargin({ deal_type: "one_time", amount: 1000000, term_months: null }, { IN: 220, SG: 50 }, rates);
  assert.equal(base.cost, 515000);
  assert.ok(creep.margin_pct! < base.margin_pct!);
});

test("formatINR uses Indian grouping", () => {
  assert.equal(formatINR(800000), "₹8,00,000");
  assert.equal(formatINR(20000), "₹20,000");
});

console.log(`\n${passed} tests passed`);
