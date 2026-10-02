import { EngineBadge } from "@/components/EngineBadge";
import { PageHeader } from "@/components/PageHeader";
import { aiUsage, MODEL } from "@/lib/claude";
import type { Engine } from "@/lib/modules";
import evalResults from "@/data/eval-results.json";

export const dynamic = "force-dynamic";

type Row = { area: string; engine: Engine; real: string; simulated: string };

const ROWS: Row[] = [
  {
    area: "Deal Integrity Agent",
    engine: "ai",
    real: "Live Claude call with structured output; deterministic validator re-checks amounts, dates, types, naming, partner; every run stored in deal_analyses; human approval is the only path into deals.",
    simulated: "Accuracy measured on invented, builder-labelled deals, not a real CRM export: see AI accuracy (eval) below (held-out set of 6, plus 18 earlier cases).",
  },
  {
    area: "Onboarding Orchestrator",
    engine: "ai",
    real: "Claude drafts the brief; code validates milestone percentages and dates; approval creates invoice rows.",
    simulated: "Invoices are rows in our DB, not raised in Zoho Books. Future-dated invoices are scheduled, not sent.",
  },
  {
    area: "Clawback",
    engine: "rules",
    real: "Deadline = end of the following quarter; proportional clawback on partial payment; per-owner roll-up. Unit-tested.",
    simulated: "Variable pay at stake is an invented 5% of invoice amount. 60-day at-risk window invented. Clawback per invoice, no owner-quarter netting. As-of date is a demo time machine.",
  },
  {
    area: "Margin",
    engine: "rules",
    real: "Blended IN/SG rate from logged hours; margin and erosion vs target; what-if hours.",
    simulated: "Rates invented (IN ₹2,000/h, SG ₹6,500/h), flat across roles. Pass-through costs stubbed at ₹0. No planned hours, so the plan is a target margin %. Recurring price = monthly × term.",
  },
  {
    area: "Leak engine (exceptions inbox)",
    engine: "rules",
    real: "One deterministic rule set across all 5 stages: integrity, billing plan, attribution, partner registration, renewals, invoice coverage, clawback, margin. Ranked by severity and ₹ impact. Unit-tested.",
    simulated: "Thresholds invented (renewal 90 days, urgent 30 days, margin floor 30%). No email/Slack notifications; recomputed on page load.",
  },
  {
    area: "Automation & notifications",
    engine: "ai",
    real: "New deals are analysed automatically on arrival; approval auto-drafts the onboarding brief; a leak scan pushes new critical/warning leaks to the deal owner's in-app notifications.",
    simulated: "Runs in-process after the response (no queue or retries); pauses with 5 AI calls left; max 5 auto-analyses per upload. In-app only, no email/Slack; 'viewing as' is a dropdown, not a login.",
  },
  {
    area: "Partner (co-sell / MDF)",
    engine: "stub",
    real: "Agent detects and flags partner involvement and MDF amounts; MDF is kept out of revenue.",
    simulated: "Flag only. No deal registration, MDF claims or partner reconciliation.",
  },
  {
    area: "Data & integrations",
    engine: "data",
    real: "Supabase Postgres; Ingest supports paste, CSV with row-level validation, and quick form; all writes server-side.",
    simulated: "All data invented. No Zoho CRM/Books sync. All money in INR, no FX.",
  },
  {
    area: "Security",
    engine: "stub",
    real: "Claude and service-role keys server-side only; deal text passed to the model as tagged data (prompt-injection guard).",
    simulated: "No auth, no Row Level Security: single-user demo. Claude usage is capped at a fixed number of calls via an ai_calls ledger, not per-user rate limits.",
  },
];

const QUESTIONS = [
  "Quarters: calendar or Indian FY (Apr–Mar)? Assumed calendar. Both use the same three-month blocks, so deadlines don't change; only quarter labels do.",
  "Is variable pay clawed back per invoice or netted at owner-quarter level? Assumed per invoice.",
  "Does a recurring deal's amount in Zoho mean monthly value or total contract value? Assumed monthly.",
  "Which currency governs cross-entity deals, at what FX rate? Assumed INR everywhere.",
  "How are practice splits applied when one description becomes two records? Built as one split applied to both; practice-side pay not computed.",
  "Who approves a split: rep, ops lead or finance? Built as ops lead, any named approver.",
];

export default async function HonestyPage() {
  const aiLive = !!process.env.ANTHROPIC_API_KEY;
  const usage = await aiUsage().catch(() => null);
  return (
    <>
      <PageHeader title="Honesty" engine="data">
        What in this tool is real, what is simulated, and the assumptions I would confirm before relying on it.
      </PageHeader>

      <div className={`mb-6 rounded-lg border p-3 text-sm ${aiLive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
        Claude API on this deployment: <b>{aiLive ? `live (${MODEL})` : "not configured"}</b>.
        {usage?.used != null && ` Calls used: ${usage.used} / ${usage.limit} (hard cap; further calls fall back to manual entry).`}
        {!aiLive && " AI modules fall back to manual entry; nothing is guessed."}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Area</th>
              <th className="px-4 py-2 font-medium">Real</th>
              <th className="px-4 py-2 font-medium">Simulated / stubbed</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.area} className="border-t border-zinc-100 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.area}</div>
                  <div className="mt-1">
                    <EngineBadge engine={r.engine} />
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-700">{r.real}</td>
                <td className="px-4 py-3 text-zinc-700">{r.simulated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Assumptions I made and would confirm</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
        {QUESTIONS.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>

      <EvalSection />
    </>
  );
}

// ---------- AI accuracy (eval) ----------
// Numbers come from scripts/eval-integrity.ts (src/data/eval-results.json); nothing here is computed live.

const SETS = evalResults.sets;
const H = SETS.v2_heldout.summary;
const pctOrDash = (p: number | null) => (p == null ? "–" : `${p}%`);
const SET_ROWS = [
  { key: "v1_original", name: "v1 original", note: "18 cases, first prompt and checks", s: SETS.v1_original.summary },
  { key: "v1_rescored", name: "v1 re-checked", note: "same 18 model outputs, fixed checks, 0 new calls", s: SETS.v1_rescored.summary },
  { key: "v2_heldout", name: "v2 held-out", note: "6 new cases, fixed prompt + checks (headline)", s: H },
  { key: "v2_rerun", name: "v1 failures re-run", note: "not held-out: fixes were derived from these", s: SETS.v2_rerun.summary },
];
const TOTAL_COST = SET_ROWS.filter((r) => r.key !== "v1_rescored").reduce((a, r) => a + r.s.usage.cost_usd, 0);

function Tile({ label, value, sub, tone = "zinc" }: { label: string; value: string; sub: string; tone?: "zinc" | "amber" }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "amber" ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white"}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-zinc-600">{sub}</div>
    </div>
  );
}

function CalibrationCell({ c }: { c: { cases: number; fully_correct: number; pct_correct: number | null } }) {
  return <>{c.cases ? `${c.fully_correct}/${c.cases} (${pctOrDash(c.pct_correct)})` : "–"}</>;
}

function EvalSection() {
  const misses = [
    ...SETS.v2_heldout.cases.map((c) => ({ ...c, set: "held-out" })),
    ...SETS.v2_rerun.cases.map((c) => ({ ...c, set: "re-run" })),
  ].filter((c) => c.outcome !== "correct");
  const calV1 = SETS.v1_rescored.summary.calibration.final;
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-sm font-semibold">AI accuracy (eval)</h2>
      <p className="mb-4 max-w-3xl text-sm text-zinc-600">
        The Deal Integrity Agent runs through the production pipeline (Claude proposal, then the code checks) on labelled deal texts.
        The number that matters for money is the silent error rate: wrong proposals that look clean, so a human could approve them.
        Headline numbers are from the held-out set: {H.cases} new cases written after the fixes and never used to tune them.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Silent error rate (held-out)" value={pctOrDash(H.silent_error_rate_pct)} sub={`${H.silent} of ${H.cases} cases wrong with no flag`} tone="amber" />
        <Tile label="Cases fully correct (held-out)" value={`${H.fully_correct}/${H.cases}`} sub={`${pctOrDash(H.fully_correct_pct)} of cases, every field right`} />
        <Tile label="Field accuracy (held-out)" value={pctOrDash(H.field_accuracy_pct)} sub={`${H.field_checks.correct} of ${H.field_checks.scored} field checks`} />
        <Tile label="Errors caught by checks (held-out)" value={`${H.caught}/${H.incorrect}`} sub="flagged, low confidence or asked" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 text-right font-medium">Fully correct</th>
              <th className="px-4 py-2 text-right font-medium">Field acc.</th>
              <th className="px-4 py-2 text-right font-medium">Silent errors</th>
              <th className="px-4 py-2 text-right font-medium">Caught</th>
              <th className="px-4 py-2 text-right font-medium">False alarms</th>
            </tr>
          </thead>
          <tbody>
            {SET_ROWS.map(({ key, name, note, s }) => (
              <tr key={key} className={`border-t border-zinc-100 ${key === "v2_heldout" ? "bg-zinc-50" : ""}`}>
                <td className="px-4 py-2">
                  <div className={key === "v2_heldout" ? "font-semibold" : "font-medium"}>{name}</div>
                  <div className="text-xs text-zinc-500">{note}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s.fully_correct}/{s.cases}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pctOrDash(s.field_accuracy_pct)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${s.silent ? "font-semibold text-amber-700" : ""}`}>
                  {s.silent} ({pctOrDash(s.silent_error_rate_pct)})
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s.caught}/{s.incorrect}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.false_alarms.cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          False alarm = correct and complete, but a check still flagged it (forces low confidence). After v1 the checks gained foreign-currency
          and pending-registration detection, bare lakh/crore parsing and an excluded-amounts field; the prompt gained matching rules.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Final confidence</th>
                <th className="px-4 py-2 text-right font-medium">Correct, v1 re-checked</th>
                <th className="px-4 py-2 text-right font-medium">Correct, held-out</th>
              </tr>
            </thead>
            <tbody>
              {H.calibration.final.map((f, i) => (
                <tr key={f.confidence} className="border-t border-zinc-100">
                  <td className="px-4 py-2 capitalize">{f.confidence}</td>
                  <td className="px-4 py-2 text-right tabular-nums"><CalibrationCell c={calV1[i]} /></td>
                  <td className="px-4 py-2 text-right tabular-nums"><CalibrationCell c={f} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold text-zinc-500">Still wrong after the fixes</h3>
          {misses.length === 0 ? (
            <p className="text-sm text-zinc-700">None.</p>
          ) : (
            <ul className="space-y-2 text-sm text-zinc-700">
              {misses.map((c) => (
                <li key={`${c.set}-${c.id}`}>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${c.outcome === "silent" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-700"}`}>
                    {c.outcome}
                  </span>
                  <b>{c.id}</b> ({c.set}) {c.tests}. Wrong: {c.wrong.join(", ")}.{c.caught_by.length > 0 && ` Caught by ${c.caught_by.join("; ")}.`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Model {H.model}, dates resolved against {H.eval_today}. {evalResults.total_calls.total} Claude calls in total ({evalResults.total_calls.v1} for v1,{" "}
        {evalResults.total_calls.v2} for v2), about ${TOTAL_COST.toFixed(2)} ({H.usage.pricing}). Full per-case detail in docs/eval/report.md.
      </p>
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Read these numbers with care: small invented sets (18 + {H.cases} cases), labels written by the builder, one run per case. With{" "}
        {H.cases} held-out cases, one case moves a rate by about 17 points. This shows the checks catch the model mistakes we know about;
        it is not a substitute for an eval on real CRM data.
      </div>
    </section>
  );
}
