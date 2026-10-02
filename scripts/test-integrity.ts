// Deterministic validator tests: npx tsx scripts/test-integrity.ts
import assert from "node:assert/strict";
import { extractAmounts, extractDates, validateProposal, type IntegrityOutput } from "../src/lib/integrity";
import { rawDeals } from "../src/lib/demo-data";

const TODAY = "2026-10-02";
const text = (n: number) => rawDeals[n - 1].raw_text;
const codes = (v: { flags: { code: string }[] }) => v.flags.map((f) => f.code).sort();

// Parsing
assert.deepEqual(extractAmounts(text(1)), [800000, 50000]);
assert.deepEqual(extractAmounts(text(3)), [450000]);
assert.deepEqual(extractAmounts(text(6)), [1500000, 200000]);
assert.deepEqual(extractDates(text(1), TODAY), ["2026-11-30"]);
assert.deepEqual(extractDates(text(2), TODAY), ["2027-01-01"]);

// Acme: correct split with an assumed start date -> no flags, capped at medium.
const acme: IntegrityOutput = {
  client_name: "Acme Retail", is_blended: true, rep_label_conflict: null,
  records: [
    { name: "Acme Retail - Website Rebuild", deal_type: "one_time", amount: 800000, term_months: null, close_date: "2026-11-30", close_date_basis: "project end stated", scope: "Website rebuild" },
    { name: "Acme Retail - Support Retainer", deal_type: "recurring", amount: 50000, term_months: 12, close_date: "2026-12-01", close_date_basis: "first billing; 'starting Dec' assumed 1 Dec", scope: "Monthly support" },
  ],
  partner: { name: "AWS", type: "co-sell", mdf_amount: null, deal_registered: null },
  ambiguities: [{ question: "Does support start 1 Dec or after go-live?", field: "close_date", record_index: 1 }], confidence: "high", reasoning: "…",
};
let v = validateProposal(text(1), acme, TODAY);
assert.deepEqual(codes(v), []);
assert.equal(v.confidence, "medium");
assert.equal(v.needs_human, true);

// Acme collapsed into one record (the failure we exist to catch).
v = validateProposal(text(1), {
  ...acme, is_blended: false, partner: null,
  records: [{ name: "acme retail website", deal_type: "one_time", amount: 1400000, term_months: 12, close_date: "2026-11-30", close_date_basis: "stated", scope: "x" }],
}, TODAY);
assert.deepEqual(codes(v), ["amount_not_in_text", "amount_unaccounted", "amount_unaccounted", "naming", "partner_missed", "type_mixed"]);
assert.equal(v.confidence, "low");

// Unstated date not marked assumed.
v = validateProposal(text(1), { ...acme, records: [acme.records[0], { ...acme.records[1], close_date_basis: "first billing" }] }, TODAY);
assert.deepEqual(codes(v), ["date_unsupported"]);

// Stark: MDF ₹2L accounted for by partner, not revenue.
const stark: IntegrityOutput = {
  client_name: "Stark Industries", is_blended: false, rep_label_conflict: null,
  records: [{ name: "Stark Industries - GenAI Knowledge Assistant", deal_type: "one_time", amount: 1500000, term_months: null, close_date: "2027-02-28", close_date_basis: "delivery date stated", scope: "x" }],
  partner: { name: "Microsoft", type: "co-sell", mdf_amount: 200000, deal_registered: true },
  ambiguities: [], confidence: "high", reasoning: "…",
};
v = validateProposal(text(6), stark, TODAY);
assert.deepEqual(codes(v), []);
assert.equal(v.confidence, "high");
assert.equal(v.needs_human, false);
v = validateProposal(text(6), { ...stark, partner: { ...stark.partner!, mdf_amount: null } }, TODAY);
assert.deepEqual(codes(v), ["amount_unaccounted"]);

// Initech: honest nulls -> flags, low confidence.
v = validateProposal(text(4), {
  client_name: "Initech", is_blended: false, rep_label_conflict: null,
  records: [{ name: "Initech - Ongoing Support", deal_type: "recurring", amount: null, term_months: null, close_date: null, close_date_basis: "unknown", scope: "support" }],
  partner: null, ambiguities: [{ question: "Amount?", field: "amount", record_index: 0 }], confidence: "low", reasoning: "…",
}, TODAY);
assert.deepEqual(codes(v), ["amount_missing", "amount_unaccounted", "date_missing", "term_missing"]);
assert.equal(v.confidence, "low");

// Globex: mislabelled retainer must be explained.
const globex: IntegrityOutput = {
  client_name: "Globex Logistics", is_blended: false, rep_label_conflict: null,
  records: [{ name: "Globex Logistics - Data Platform Retainer", deal_type: "recurring", amount: 300000, term_months: 6, close_date: "2027-01-01", close_date_basis: "billing start stated", scope: "x" }],
  partner: null, ambiguities: [], confidence: "high", reasoning: "…",
};
assert.deepEqual(codes(validateProposal(text(2), globex, TODAY)), ["label_conflict_unexplained"]);
assert.deepEqual(codes(validateProposal(text(2), { ...globex, rep_label_conflict: "Marked one-time, billed monthly" }, TODAY)), []);

// Rep answer confirms the date: no longer "assumed", stated via answer -> high.
v = validateProposal(text(1), {
  ...acme, ambiguities: [],
  records: [acme.records[0], { ...acme.records[1], close_date_basis: "confirmed by rep" }],
}, TODAY, [{ field: "close_date", answer: "2026-12-01" }]);
assert.deepEqual(codes(v), []);
assert.equal(v.confidence, "high");
// Without the answer the same proposal is unsupported.
assert.deepEqual(codes(validateProposal(text(1), { ...acme, ambiguities: [], records: [acme.records[0], { ...acme.records[1], close_date_basis: "confirmed by rep" }] }, TODAY)), ["date_unsupported"]);

console.log("integrity validator: all tests passed");
