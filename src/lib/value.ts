import "server-only";
import { db } from "./db";
import type { IntegrityOutput } from "./integrity";
import { WARNING_MARGIN_PCT } from "./margin";
import type { Snapshot } from "./snapshot";

// "Pain → value" scorecard, computed from live data. Estimates are labelled as such.

// Hands-on time a person spends today, per item (assumptions, shown in the UI).
export const MANUAL_MINUTES = {
  dealCorrection: 30, // spot, chase rep on Slack, fix in Zoho
  briefDraft: 180, // kickoff scramble: brief, milestones, success criteria
  invoiceTracking: 20, // per invoice per quarter in the clawback spreadsheet
  alertTriage: 15, // finding each leak by hand in reports
};
const HAIKU_PRICE = { input: 1 / 1e6, output: 5 / 1e6 }; // USD per token

type Out = Partial<IntegrityOutput> | null | undefined;

export async function computeValue(s: Snapshot) {
  const analysed = s.raw.filter((r) => r.analysis);
  const outOf = (r: (typeof s.raw)[number]) => r.analysis?.output as Out;

  // 1-2. Deal hygiene at entry
  const blended = analysed.filter((r) => outOf(r)?.is_blended);
  const labelConflicts = analysed.filter((r) => outOf(r)?.rep_label_conflict);
  const renamed = analysed.filter((r) =>
    (outOf(r)?.records ?? []).some((rec) => !r.raw_text.toLowerCase().includes(rec.name.toLowerCase())),
  );
  const flagged = analysed.filter((r) => (r.analysis?.validator_flags?.flags?.length ?? 0) > 0);
  const corrected = analysed.filter((r) => blended.includes(r) || labelConflicts.includes(r) || renamed.includes(r) || flagged.includes(r));
  // Recurring value that would have sat inside a one-time record (blended) or been labelled one-time (mislabelled).
  const arrProtected = [...new Set([...blended, ...labelConflicts])].reduce(
    (sum, r) =>
      sum +
      (outOf(r)?.records ?? [])
        .filter((rec) => rec.deal_type === "recurring" && rec.amount && rec.term_months)
        .reduce((x, rec) => x + rec.amount! * rec.term_months!, 0),
    0,
  );

  // 3. Onboarding: approval → approved brief
  const briefTimes = s.deals
    .filter((d) => d.brief?.status === "approved" && d.brief.approved_at && d.approved_at)
    .map((d) => (Date.parse(d.brief!.approved_at!) - Date.parse(d.approved_at!)) / 60000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const medianBriefMin = briefTimes.length ? briefTimes[Math.floor(briefTimes.length / 2)] : null;
  const withPlan = s.deals.filter((d) => d.brief_status === "approved" || d.invoices.length > 0).length;

  // 4. Clawback visibility
  const live = s.evals.filter((e) => e.days_left >= 0 && e.projected_exposure > 0);
  const exposureVisible = live.reduce((x, e) => x + e.projected_exposure, 0);
  const minDaysToAct = live.length ? Math.min(...live.map((e) => e.days_left)) : null;
  const realised = s.evals.filter((e) => e.realised_clawback > 0);

  // 5. Margin
  const tracked = s.margins.filter((m) => m.status !== "no_hours");
  const belowFloor = tracked.filter((m) => m.status === "warning");
  const floorGap = belowFloor.reduce((x, m) => x + Math.max(0, WARNING_MARGIN_PCT * m.price - (m.margin ?? 0)), 0);

  // 6. Partner
  const partnerDeals = s.deals.filter((d) => d.partner);
  const mdf = partnerDeals.reduce((x, d) => x + Number(d.partner_flags?.mdf_amount ?? 0), 0);
  const unregistered = partnerDeals.filter((d) => d.partner_flags?.deal_registered !== true).length;
  const partnerPending = analysed.filter((r) => r.status !== "approved" && outOf(r)?.partner).length;

  // AI cost so far (ledger) and hands-on time an ops team would have spent.
  const calls = await db().from("ai_calls").select("status,input_tokens,output_tokens");
  const rows = (calls.data ?? []) as { status: string; input_tokens: number | null; output_tokens: number | null }[];
  const aiCost = rows.reduce((x, r) => x + (r.input_tokens ?? 0) * HAIKU_PRICE.input + (r.output_tokens ?? 0) * HAIKU_PRICE.output, 0);
  const briefsApproved = s.deals.filter((d) => d.brief_status === "approved").length;
  const minutesSaved =
    corrected.length * MANUAL_MINUTES.dealCorrection +
    briefsApproved * MANUAL_MINUTES.briefDraft +
    s.invoices.length * MANUAL_MINUTES.invoiceTracking +
    s.alerts.filter((a) => a.severity !== "info").length * MANUAL_MINUTES.alertTriage;

  return {
    asOf: s.asOf,
    headline: {
      correctionRate: analysed.length ? corrected.length / analysed.length : null,
      corrected: corrected.length,
      analysed: analysed.length,
      medianBriefMin,
      briefsApproved,
      arrProtected,
      clawbackSurprises: realised.length,
      exposureVisible,
      minDaysToAct,
      hoursSaved: minutesSaved / 60,
      aiCalls: rows.length,
      aiCostUsd: aiCost,
    },
    rows: [
      {
        pain: "Reps blend one-time and recurring scope in one deal",
        cost: "Forecast (one-time vs ARR) is wrong, so leadership plans on bad numbers",
        does: "AI catches it at entry and proposes the two-record split with correct close dates",
        evidence: [
          { label: "Blended deals caught", value: String(blended.length) },
          { label: "Recurring value kept out of one-time", value: inr(arrProtected) },
        ],
        href: "/pipeline",
        ok: true,
      },
      {
        pain: "Inconsistent naming and mislabelled deal types",
        cost: "Reports can't be trusted, and someone cleans them by hand",
        does: "Standard naming and correct types, with the reason shown to the rep",
        evidence: [
          { label: "Mislabelled types caught", value: String(labelConflicts.length) },
          { label: "Records renamed to standard", value: String(renamed.length) },
          { label: "Failed checks stopped before approval", value: String(flagged.length) },
        ],
        href: "/pipeline",
        ok: true,
      },
      {
        pain: "Sales closes, then delivery scrambles",
        cost: "Delays, missed promises, no success criteria, billing set up late",
        does: "AI drafts brief, milestones and success criteria; a human signs off; invoices follow",
        evidence: [
          { label: "Deal approval → approved brief (median)", value: medianBriefMin == null ? "no briefs yet" : duration(medianBriefMin) },
          { label: "Deals with a billing plan", value: `${withPlan}/${s.deals.length}` },
        ],
        href: "/onboarding",
        ok: s.deals.length === 0 || withPlan === s.deals.length,
      },
      {
        pain: "Invoice → cash → clawback lives in spreadsheets",
        cost: "Clawbacks found a month after quarter close: people lose pay, no time to chase",
        does: "Live deadline tracking and per-person exposure while there is still time to act",
        evidence: [
          { label: "Exposure visible now", value: inr(exposureVisible) },
          { label: "Soonest deadline", value: minDaysToAct == null ? "none open" : `${minDaysToAct} days to act` },
          { label: "Clawbacks already realised", value: `${realised.length} (${inr(realised.reduce((x, e) => x + e.realised_clawback, 0))})` },
        ],
        href: "/clawback",
        ok: realised.length === 0,
      },
      {
        pain: "Margin is a black box",
        cost: "Scope creep and costly onsite hours erode profit, found late or never",
        does: "Live margin against quoted price as hours move",
        evidence: [
          { label: "Deals with margin tracked", value: `${tracked.length}/${s.deals.length}` },
          { label: "Below 30% floor right now", value: String(belowFloor.length) },
          { label: "Gap to floor", value: inr(floorGap) },
        ],
        href: "/margin",
        ok: belowFloor.length === 0,
      },
      {
        pain: "Partner (co-sell) deals sit outside the flow",
        cost: "Manual reconciliation, missed attribution",
        does: "Flagged at deal entry (full partner handling is a later phase)",
        evidence: [
          { label: "Partner deals flagged", value: String(partnerDeals.length + partnerPending) },
          { label: "Unregistered", value: String(unregistered) },
          { label: "MDF tracked outside revenue", value: inr(mdf) },
        ],
        href: "/",
        ok: unregistered === 0,
      },
    ],
    assumptions: MANUAL_MINUTES,
  };
}

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function duration(min: number) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 60 * 48) return `${(min / 60).toFixed(1)} h`;
  return `${Math.round(min / 1440)} days`;
}
