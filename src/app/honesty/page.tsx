import { EngineBadge } from "@/components/EngineBadge";
import { PageHeader } from "@/components/PageHeader";
import { aiUsage, MODEL } from "@/lib/claude";
import type { Engine } from "@/lib/modules";

export const dynamic = "force-dynamic";

type Row = { area: string; engine: Engine; real: string; simulated: string };

const ROWS: Row[] = [
  {
    area: "Deal Integrity Agent",
    engine: "ai",
    real: "Live Claude call with structured output; deterministic validator re-checks amounts, dates, types, naming, partner; every run stored in deal_analyses; human approval is the only path into deals.",
    simulated: "Tested on 6 invented messy deals, not a real CRM export. No precision/recall measured yet.",
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
    </>
  );
}
