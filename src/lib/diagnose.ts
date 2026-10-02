// "Diagnose": groups leak-engine alerts by leak type, ranks by money at stake,
// and attaches next steps + runnable actions. Pure (shared by API and UI).
import type { Alert, Severity, Stage } from "./leaks";

export type ActionKind =
  | "analyse" // AI: run the integrity agent on a raw deal
  | "review" // link: human review/approve in Deal Integrity
  | "draft_brief" // AI: draft onboarding brief
  | "assist" // AI: draft next step / message (chase, renewal, change request)
  | "record_payment" // form: payment against the invoice
  | "log_hours" // form: timesheet
  | "mark_registered" // write: partner deal registered
  | "set_practice"; // write: practice split

export type LeakType = {
  key: string;
  title: string;
  stage: Stage;
  leak: string; // what is being lost, in money terms
  steps: string[];
  actions: ActionKind[];
};

export const LEAK_TYPES: LeakType[] = [
  { key: "cash-clawback", stage: "cash", title: "Variable pay already clawed back", leak: "Invoices missed their realization deadline; the owner loses that share of variable pay.", steps: ["Tell the owner and finance now, not at quarter close", "Chase the outstanding balance anyway: cash still matters", "Note the root cause (client process, disputed milestone) for the next deal"], actions: ["assist", "record_payment"] },
  { key: "cash-risk", stage: "cash", title: "Clawback risk before the deadline", leak: "Unpaid invoices close to the end of the following quarter; variable pay is about to be lost.", steps: ["Send a payment chase to the client's accounts payable", "Record the payment as soon as it lands", "Escalate to the account owner if nothing moves in a week"], actions: ["assist", "record_payment"] },
  { key: "margin-floor", stage: "margin", title: "Margin below the 30% floor", leak: "Hours (often onsite Singapore time) have eaten into the quoted price.", steps: ["Check whether the extra work is in scope", "Raise a change request for out-of-scope work", "Shift remaining work offshore where possible"], actions: ["assist", "log_hours"] },
  { key: "booking-noplan", stage: "booking", title: "Booked with no billing plan", leak: "Contracted value with no milestones will never be invoiced, so no revenue and no variable pay.", steps: ["Draft the delivery brief and billing milestones", "Have delivery approve them", "Approval schedules the invoices automatically"], actions: ["draft_brief"] },
  { key: "booking-renewal", stage: "booking", title: "Retainer renewal due", leak: "Recurring revenue lapses if nobody starts the renewal.", steps: ["Start the renewal conversation", "Confirm scope and price changes", "Book the renewal as a new recurring deal"], actions: ["assist"] },
  { key: "invoice-gap", stage: "invoice", title: "Contract not fully scheduled for invoicing", leak: "Part of the contracted value has no invoice planned.", steps: ["Compare milestones to the contract", "Add the missing milestone in Onboarding"], actions: ["draft_brief"] },
  { key: "invoice-over", stage: "invoice", title: "Invoiced more than contracted", leak: "Possible duplicate or out-of-scope invoice; client dispute risk.", steps: ["Reconcile invoices against the contract", "Credit-note any duplicate"], actions: ["assist"] },
  { key: "deal-flags", stage: "deal", title: "Deal failed integrity checks", leak: "Approving bad data corrupts forecast, invoicing and clawback downstream.", steps: ["Open the analysis and read the failed checks", "Answer the rep questions or fix the records", "Re-analyse or approve with corrections"], actions: ["review"] },
  { key: "deal-blended", stage: "deal", title: "Blended deal awaiting split", leak: "Until split, recurring revenue sits inside a one-time record and the ARR forecast is wrong.", steps: ["Review the proposed two-record split", "Confirm the assumed dates with the rep", "Approve"], actions: ["review"] },
  { key: "booking-attrib", stage: "booking", title: "No practice attribution", leak: "The practice side of the double bubble can't be credited or paid.", steps: ["Set the practice split (must total 100%)"], actions: ["set_practice"] },
  { key: "booking-partner", stage: "booking", title: "Partner deal not registered", leak: "Co-sell benefits and partner attribution are at risk.", steps: ["Register the deal in the partner portal", "Mark it registered here"], actions: ["mark_registered"] },
  { key: "margin-target", stage: "margin", title: "Margin below target", leak: "Profit eroding but still above the floor.", steps: ["Watch weekly hours", "Check the India/Singapore mix"], actions: ["log_hours"] },
  { key: "deal-unreviewed", stage: "deal", title: "Deals not yet checked", leak: "Raw deal text hasn't been through the integrity agent; type, split and dates are unverified.", steps: ["Run the integrity agent", "Review its proposal"], actions: ["analyse"] },
  { key: "deal-ready", stage: "deal", title: "Checked deals awaiting approval", leak: "Clean deals waiting on a human; nothing downstream starts until approved.", steps: ["Approve in Deal Integrity"], actions: ["review"] },
  { key: "booking-mdf", stage: "booking", title: "MDF to claim", leak: "Partner funding goes unclaimed if not tracked (claim process is outside this tool).", steps: ["Submit the MDF claim with the partner team"], actions: [] },
  { key: "cash-partial", stage: "cash", title: "Partially paid invoices", leak: "Exposure if nothing more lands before the deadline.", steps: ["Monitor; chase if it drifts towards the deadline"], actions: ["record_payment"] },
  { key: "margin-blind", stage: "margin", title: "Billing but no effort logged", leak: "Margin is invisible without timesheets.", steps: ["Ask delivery to log hours"], actions: ["log_hours"] },
];

export type ActionDraft = {
  id: string;
  status: "drafting" | "ready" | "failed" | "sent" | "dismissed";
  assist: { situation: string; next_steps: string[]; draft_message: { to: string; subject: string; body: string } | null } | null;
  unverified_amounts: number[] | null;
  detail: string | null;
  created_at: string;
};
export type LeakItem = Alert & { deal_name: string | null; milestone: string | null; outstanding: number | null; draft: ActionDraft | null };
export type LeakGroup = LeakType & {
  severity: Severity;
  count: number;
  impact: number;
  items: LeakItem[];
};

const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function typeOf(alertId: string) {
  return LEAK_TYPES.find((t) => alertId.startsWith(`${t.key}-`)) ?? null;
}

export function groupLeaks(items: LeakItem[]): LeakGroup[] {
  const groups: LeakGroup[] = [];
  for (const t of LEAK_TYPES) {
    const mine = items.filter((a) => typeOf(a.id)?.key === t.key);
    if (!mine.length) continue;
    const severity = mine.reduce<Severity>((s, a) => (rank[a.severity] < rank[s] ? a.severity : s), "info");
    groups.push({ ...t, severity, count: mine.length, impact: mine.reduce((x, a) => x + (a.impact ?? 0), 0), items: mine });
  }
  return groups.sort((a, b) => rank[a.severity] - rank[b.severity] || b.impact - a.impact);
}
