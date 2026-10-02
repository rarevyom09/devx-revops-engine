// Leak engine tests: npx tsx scripts/test-leaks.ts
import assert from "node:assert/strict";
import { evaluateInvoice } from "../src/lib/clawback";
import { findLeaks, type DealIn } from "../src/lib/leaks";

const TODAY = "2026-10-02";
const base: DealIn = {
  id: "d1", name: "Acme Retail - Support Retainer", deal_type: "recurring", amount: 50000, term_months: 12,
  close_date: "2025-12-01", total: 600000, practice_split: { Web: 1 }, partner: null, partner_flags: null,
  brief_status: "approved", scheduled_invoice_total: 600000,
};
const run = (deals: DealIn[], extra: Partial<Parameters<typeof findLeaks>[0]> = {}) =>
  findLeaks({ today: TODAY, rawDeals: [], deals, invoices: [], margins: [], ...extra });
const ids = (a: { id: string }[]) => a.map((x) => x.id.replace(/-d1$|-i1$/, ""));

// Clean deal: no alerts. Contract ends 2026-12-01 (60 days) -> renewal warning.
let a = run([base]);
assert.deepEqual(ids(a), ["booking-renewal"]);
assert.equal(a[0].severity, "warning");
assert.equal(a[0].impact, 600000);

// Renewal within 30 days is critical; outside 90 days, nothing.
assert.equal(run([{ ...base, close_date: "2025-10-20" }])[0].severity, "critical");
assert.deepEqual(run([{ ...base, close_date: "2026-06-01" }]), []);

// Missing practice split, split not summing to 100%.
const oneTime: DealIn = { ...base, deal_type: "one_time", term_months: null, amount: 800000, total: 800000, scheduled_invoice_total: 800000, close_date: "2026-11-30" };
assert.deepEqual(ids(run([{ ...oneTime, practice_split: null }])), ["booking-attrib"]);
assert.match(run([{ ...oneTime, practice_split: { AI: 0.5, Web: 0.3 } }])[0].detail, /80%/);

// Partner: unregistered -> warning; MDF -> info with impact.
a = run([{ ...oneTime, partner: "Microsoft", partner_flags: { deal_registered: null, mdf_amount: 200000 } }]);
assert.deepEqual(ids(a), ["booking-partner", "booking-mdf"]);
assert.deepEqual(ids(run([{ ...oneTime, partner: "AWS", partner_flags: { deal_registered: true } }])), []);

// No billing plan: warning; critical once the project end has passed.
a = run([{ ...oneTime, brief_status: "none", scheduled_invoice_total: 0 }]);
assert.deepEqual([a[0].id, a[0].severity, a[0].impact], ["booking-noplan-d1", "warning", 800000]);
assert.equal(run([{ ...oneTime, brief_status: "none", scheduled_invoice_total: 0, close_date: "2026-09-01" }])[0].severity, "critical");

// Invoice coverage: gap and over-invoicing.
assert.deepEqual(run([{ ...oneTime, scheduled_invoice_total: 500000 }]).map((x) => [x.id, x.impact]), [["invoice-gap-d1", 300000]]);
assert.equal(run([{ ...oneTime, scheduled_invoice_total: 900000 }])[0].severity, "critical");

// Clawback: at-risk escalates to critical within 30 days; ordering by severity then impact.
const inv = { id: "i1", milestone: "UAT", amount: 400000, raised_on: "2026-09-10", owner_id: null, variable_pay_at_stake: 20000, deal_name: "Wayne", owner_name: "Priya" };
const pay = [{ invoice_id: "i1", amount: 150000, paid_on: "2026-10-01" }];
const at = (asOf: string) => findLeaks({ today: asOf, rawDeals: [], deals: [], margins: [], invoices: [evaluateInvoice(inv, pay, asOf)] })[0];
assert.equal(at("2026-10-02").id, "cash-partial-i1");
assert.equal(at("2026-11-15").severity, "warning");
assert.equal(at("2026-12-10").severity, "critical");
assert.equal(at("2027-01-05").id, "cash-clawback-i1");
assert.equal(at("2027-01-05").impact, 12500);

// Attribution: every alert points at the record it is about (invoice alerts carry the deal id).
assert.deepEqual(run([base])[0].ref, { kind: "deal", id: "d1", deal_id: "d1" });
const withDeal = findLeaks({ today: TODAY, rawDeals: [], deals: [], margins: [], invoices: [{ ...evaluateInvoice(inv, pay, TODAY), deal_id: "d1" }] });
assert.deepEqual(withDeal[0].ref, { kind: "invoice", id: "i1", deal_id: "d1" });
assert.equal(at("2026-10-02").ref.deal_id, null);
const raw = findLeaks({ today: TODAY, deals: [], invoices: [], margins: [], rawDeals: [{ id: "r1", raw_text: "x", status: "pending", analysis: null }] });
assert.deepEqual(raw[0].ref, { kind: "raw", id: "r1", deal_id: null });

console.log("leak engine: all tests passed");
