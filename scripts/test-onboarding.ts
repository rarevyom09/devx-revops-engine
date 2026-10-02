// Run: npx tsx scripts/test-onboarding.ts
import assert from "node:assert/strict";
import {
  addMonths,
  dealTotal,
  formatINR,
  isIsoDate,
  oneTimeTemplate,
  planInvoices,
  recurringSchedule,
  validateMilestones,
  type DealLite,
  type Milestone,
} from "../src/lib/onboarding-validate";

const TODAY = "2026-10-02";
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const acmeBuild: DealLite = { deal_type: "one_time", amount: 800000, term_months: null, close_date: "2026-11-30" };
const acmeSupport: DealLite = { deal_type: "recurring", amount: 50000, term_months: 12, close_date: "2026-12-01" };
const good: Milestone[] = [
  { name: "Kickoff", pct: 40, due_date: "2026-10-05" },
  { name: "UAT sign-off", pct: 40, due_date: "2026-11-15" },
  { name: "Go-live", pct: 20, due_date: "2026-11-30" },
];

test("dates and helpers", () => {
  assert.ok(isIsoDate("2026-02-28"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("30/11/2026"));
  assert.equal(addMonths("2026-12-01", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2027-11-15", 14), "2029-01-15");
  assert.equal(formatINR(800000), "₹8,00,000");
  assert.equal(formatINR(600000), "₹6,00,000");
  assert.equal(formatINR(12345678), "₹1,23,45,678");
  assert.equal(formatINR(999), "₹999");
});

test("Acme one-time ₹8,00,000: 40/40/20 valid, invoices sum to total", () => {
  assert.deepEqual(validateMilestones(acmeBuild, good, TODAY), []);
  const inv = planInvoices(acmeBuild, good);
  assert.deepEqual(inv.map((i) => i.amount), [320000, 320000, 160000]);
  assert.deepEqual(inv.map((i) => i.variable_pay_at_stake), [16000, 16000, 8000]);
  assert.deepEqual(inv.map((i) => i.raised_on), ["2026-10-05", "2026-11-15", "2026-11-30"]);
  assert.equal(inv.reduce((s, i) => s + i.amount, 0), 800000);
});

test("Acme one-time template is valid and labelled 40/40/20", () => {
  const t = oneTimeTemplate(acmeBuild, TODAY);
  assert.deepEqual(t.map((m) => m.pct), [40, 40, 20]);
  assert.equal(t[0].due_date, TODAY);
  assert.equal(t[2].due_date, "2026-11-30");
  assert.deepEqual(validateMilestones(acmeBuild, t, TODAY), []);
});

test("Acme recurring ₹50,000 x 12: generated schedule -> 12 invoices of ₹50,000 = ₹6,00,000", () => {
  assert.equal(dealTotal(acmeSupport), 600000);
  const s = recurringSchedule(acmeSupport);
  assert.equal(s.length, 12);
  assert.equal(s[0].due_date, "2026-12-01");
  assert.equal(s[1].due_date, "2027-01-01");
  assert.equal(s[11].due_date, "2027-11-01");
  assert.equal(s[0].name, "Month 1 - Dec 2026");
  assert.ok(Math.abs(s.reduce((a, m) => a + m.pct, 0) - 100) < 1e-9);
  assert.deepEqual(validateMilestones(acmeSupport, s, TODAY), []);
  const inv = planInvoices(acmeSupport, s);
  assert.equal(inv.length, 12);
  assert.ok(inv.every((i) => i.amount === 50000 && i.variable_pay_at_stake === 2500));
  assert.equal(inv.reduce((a, i) => a + i.amount, 0), 600000);
});

test("rounding remainder goes on the last milestone", () => {
  const d: DealLite = { deal_type: "one_time", amount: 100001, term_months: null, close_date: "2026-12-31" };
  const ms: Milestone[] = [
    { name: "A", pct: 33.33, due_date: "2026-10-10" },
    { name: "B", pct: 33.33, due_date: "2026-11-10" },
    { name: "C", pct: 33.34, due_date: "2026-12-31" },
  ];
  assert.deepEqual(validateMilestones(d, ms, TODAY), []);
  const inv = planInvoices(d, ms);
  assert.deepEqual(inv.map((i) => i.amount), [33330, 33330, 33341]);
  assert.equal(inv.reduce((a, i) => a + i.amount, 0), 100001);
  // Odd recurring: 7 months of 33,333 -> exact
  const r: DealLite = { deal_type: "recurring", amount: 33333, term_months: 7, close_date: "2027-01-31" };
  const rs = recurringSchedule(r);
  assert.deepEqual(validateMilestones(r, rs, TODAY), []);
  assert.equal(rs[1].due_date, "2027-02-28");
  assert.equal(planInvoices(r, rs).reduce((a, i) => a + i.amount, 0), 233331);
});

const has = (flags: string[], re: RegExp) => assert.ok(flags.some((f) => re.test(f)), `expected ${re} in ${JSON.stringify(flags)}`);

test("validator: pct sum must be 100", () => {
  has(validateMilestones(acmeBuild, [{ ...good[0], pct: 50 }, good[1], good[2]], TODAY), /sum to 110/);
  has(validateMilestones(acmeBuild, [{ ...good[0], pct: 0 }, good[1], good[2]], TODAY), /greater than 0/);
});

test("validator: dates valid, ordered, within bounds", () => {
  has(validateMilestones(acmeBuild, [{ ...good[0], due_date: "2026-13-01" }, good[1], good[2]], TODAY), /not a valid/);
  has(validateMilestones(acmeBuild, [{ ...good[0], due_date: "2026-09-01" }, good[1], good[2]], TODAY), /before today/);
  has(validateMilestones(acmeBuild, [good[1], good[0], good[2]], TODAY), /in order/);
  has(validateMilestones(acmeBuild, [good[0], good[1], { ...good[2], due_date: "2026-12-01" }], TODAY), /after the project end/);
  // go-live may equal project end (already covered by `good`), and the "today" parameter matters:
  has(validateMilestones(acmeBuild, good, "2026-10-10"), /before today \(2026-10-10\)/);
});

test("validator: names non-empty and unique", () => {
  has(validateMilestones(acmeBuild, [{ ...good[0], name: "  " }, good[1], good[2]], TODAY), /name is empty/);
  has(validateMilestones(acmeBuild, [good[0], { ...good[1], name: "kickoff" }, good[2]], TODAY), /Duplicate/);
  has(validateMilestones(acmeBuild, [], TODAY), /No milestones/);
});

test("validator: past project end is flagged (e.g. seeded Wayne deal)", () => {
  const wayne: DealLite = { deal_type: "one_time", amount: 1000000, term_months: null, close_date: "2026-09-30" };
  has(validateMilestones(wayne, oneTimeTemplate(wayne, TODAY), TODAY), /Project end .* before today/);
});

test("validator: recurring schedule must match term and monthly dates", () => {
  const s = recurringSchedule(acmeSupport);
  has(validateMilestones(acmeSupport, s.slice(0, 11), TODAY), /exactly 12/);
  const shifted = s.map((m, i) => (i === 3 ? { ...m, due_date: "2027-03-15" } : m));
  has(validateMilestones(acmeSupport, shifted, TODAY), /should be 2027-03-01/);
  const skewed = s.map((m, i) => (i === 0 ? { ...m, pct: 20 } : i === 1 ? { ...m, pct: m.pct - 11.67 } : m));
  has(validateMilestones(acmeSupport, skewed, TODAY), /equal monthly billing/);
});

console.log(`\n${passed} tests passed`);
