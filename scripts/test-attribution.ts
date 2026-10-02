// Double-bubble tests: npx tsx scripts/test-attribution.ts
import assert from "node:assert/strict";
import { attribute } from "../src/lib/attribution";
import { evaluateInvoice } from "../src/lib/clawback";

const deals = [
  { id: "d1", name: "Zephyr - Build", owner_name: "Daniel Tan", practice_split: { Data: 0.7, Cloud: 0.3 } },
  { id: "d2", name: "No Split - Job", owner_name: "Priya Sharma", practice_split: null },
];
const inv = (id: string, deal_id: string, amount: number, raised_on: string) => ({
  ...evaluateInvoice({ id, milestone: id, amount, raised_on, owner_id: null, variable_pay_at_stake: amount * 0.05, deal_name: null, owner_name: null }, [], "2026-10-02"),
  deal_id,
});
const a = attribute(deals, [inv("i1", "d1", 1000000, "2026-09-01"), inv("i2", "d2", 200000, "2026-09-15"), inv("i3", "d1", 500000, "2026-12-01")], "2026-10-02");

// Future-dated invoice (i3) is not yet invoiced: excluded.
assert.equal(a.totals.invoiced, 1200000);
// Owner: 100% of their deals.
assert.deepEqual(a.owners.map((o) => [o.name, o.invoiced]), [["Daniel Tan", 1000000], ["Priya Sharma", 200000]]);
// Practices: pillar split of attributed deals only.
assert.deepEqual(a.practices.map((p) => [p.name, Math.round(p.invoiced)]), [["Data", 700000], ["Cloud", 300000]]);
// Variable pay at stake follows the same split.
assert.equal(Math.round(a.practices[0].at_stake), 35000);
// Missing split: owner still credited, practice side unattributed (a leak).
assert.equal(a.unattributed.invoiced, 200000);
assert.deepEqual(a.unattributed.deals, ["No Split - Job"]);
// Double bubble: total credit = owner credit + practice credit.
assert.equal(a.totals.totalCredit, 1200000 + 1000000);
console.log("attribution: all tests passed");
