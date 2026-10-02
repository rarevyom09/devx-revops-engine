import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";
import { BriefBody, MilestonesBody, loadDeal } from "@/lib/onboarding";
import { DEMO_TODAY, planInvoices, validateMilestones, type Milestone } from "@/lib/onboarding-validate";

const Body = z.object({
  brief_id: z.uuid(),
  approved_by: z.string().trim().min(1, "approved_by is required"),
  milestones: MilestonesBody.optional(), // human edits made right before approving
  brief: BriefBody.optional(),
});

type BriefRow = {
  id: string;
  deal_id: string;
  status: string;
  brief: Record<string, unknown>;
  milestones: Milestone[];
};

// POST: human approval. Re-validates; flags block approval (422). On success the
// brief becomes immutable and its milestones become scheduled invoice rows.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  const today = DEMO_TODAY;
  try {
    const rows = must(await db().from("onboarding_briefs").select("*").eq("id", b.brief_id)) as BriefRow[];
    const row = rows[0];
    if (!row) return Response.json({ error: "Brief not found." }, { status: 404 });
    if (row.status !== "draft") return Response.json({ error: "Brief already approved; it is immutable." }, { status: 409 });
    const deal = await loadDeal(row.deal_id);
    if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

    const milestones = b.milestones ?? row.milestones ?? [];
    const flags = validateMilestones(deal, milestones, today);
    const briefJson = { ...row.brief, ...(b.brief ?? {}), validator_flags: flags, validated_on: today };

    if (flags.length) {
      // Keep the human's edits as the draft, but refuse approval.
      must(await db().from("onboarding_briefs").update({ brief: briefJson, milestones }).eq("id", row.id).select("id"));
      return Response.json({ error: "Validator flags must be resolved before approval.", validator_flags: flags }, { status: 422 });
    }

    // Claim the draft atomically (status filter) so a double click can't approve twice.
    const approvedAt = new Date().toISOString();
    const claimed = must(
      await db()
        .from("onboarding_briefs")
        .update({ brief: briefJson, milestones, status: "approved", approved_by: b.approved_by, approved_at: approvedAt })
        .eq("id", row.id)
        .eq("status", "draft")
        .select(),
    ) as BriefRow[];
    if (!claimed.length) return Response.json({ error: "Brief was approved concurrently." }, { status: 409 });

    // Deals that already have invoices (e.g. seeded historical deals billed
    // before this tool existed) get NO new invoices: milestone names would
    // differ ("Kickoff" vs "Kickoff 40%") and the unique key would not stop
    // double billing. Ops reconciles those by hand.
    const existing = must(
      await db().from("invoices").select("id,milestone").eq("deal_id", deal.id),
    ) as { id: string; milestone: string }[];
    let created: unknown[] = [];
    let invoices_skipped_reason: string | null = null;
    if (existing.length) {
      invoices_skipped_reason = `Deal already has ${existing.length} invoice(s); no new invoices created to avoid double billing. Reconcile manually.`;
    } else {
      const plan = planInvoices(deal, milestones).map((p) => ({ ...p, deal_id: deal.id, owner_id: deal.owner_id }));
      const ins = await db()
        .from("invoices")
        .upsert(plan, { onConflict: "deal_id,milestone", ignoreDuplicates: true })
        .select();
      if (ins.error) {
        // Roll the approval back so the brief and invoices never disagree.
        await db()
          .from("onboarding_briefs")
          .update({ status: "draft", approved_by: null, approved_at: null })
          .eq("id", row.id);
        throw new Error(`Invoice creation failed, approval rolled back: ${ins.error.message}`);
      }
      created = ins.data ?? [];
    }
    return Response.json({ brief: claimed[0], invoices_created: created, invoices_skipped_reason });
  } catch (e) {
    return errorResponse(e);
  }
}
