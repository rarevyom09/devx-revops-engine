import { z } from "zod";
import { generateJSON } from "@/lib/claude";
import { db, errorResponse, must } from "@/lib/db";
import {
  ConflictError,
  OneTimeBriefSchema,
  RecurringBriefSchema,
  SYSTEM_PROMPT,
  buildUserPrompt,
  loadDeal,
  saveDraft,
} from "@/lib/onboarding";
import { DEMO_TODAY, recurringSchedule, templateMilestones, type Milestone } from "@/lib/onboarding-validate";

const Body = z.object({ deal_id: z.uuid() });

// POST {deal_id}: ask Claude for a brief. Success -> validated draft saved.
// Failure -> nothing saved; returns ai_error + a deterministic TEMPLATE for manual entry.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const today = DEMO_TODAY;
  try {
    const deal = await loadDeal(parsed.data.deal_id);
    if (!deal) return Response.json({ error: "Deal not found (only approved deals exist in `deals`)." }, { status: 404 });

    const approved = must(
      await db().from("onboarding_briefs").select("id").eq("deal_id", deal.id).eq("status", "approved"),
    ) as { id: string }[];
    if (approved.length) return Response.json({ error: "Brief already approved; it is immutable." }, { status: 409 });

    let rawText: string | null = null;
    if (deal.raw_deal_id) {
      const raw = must(await db().from("raw_deals").select("raw_text").eq("id", deal.raw_deal_id)) as { raw_text: string }[];
      rawText = raw[0]?.raw_text ?? null;
    }

    const user = buildUserPrompt(deal, rawText, today);
    const ai =
      deal.deal_type === "one_time"
        ? await generateJSON({ schema: OneTimeBriefSchema, system: SYSTEM_PROMPT, user, route: "onboarding.draft" })
        : await generateJSON({ schema: RecurringBriefSchema, system: SYSTEM_PROMPT, user, route: "onboarding.draft" });

    if (!ai.ok) {
      return Response.json({
        ai_error: { reason: ai.reason, detail: ai.detail },
        template: {
          scope_summary: "",
          deliverables: [],
          success_criteria: [],
          risks_and_assumptions: [],
          open_questions: [],
          milestones: templateMilestones(deal, today),
        },
      });
    }

    const { scope_summary, deliverables, success_criteria, risks_and_assumptions, open_questions } = ai.data;
    // AI drafts language, code owns money schedule: recurring milestones are generated, never AI-written.
    const milestones: Milestone[] =
      "milestones" in ai.data
        ? (ai.data.milestones as Milestone[]).map((m) => ({ name: m.name.trim(), pct: m.pct, due_date: m.due_date }))
        : recurringSchedule(deal);
    const brief = await saveDraft(
      deal,
      { scope_summary, deliverables, success_criteria, risks_and_assumptions, open_questions },
      milestones,
      { source: "ai", model: ai.model, ai_error: null },
      today,
    );
    return Response.json({ brief });
  } catch (e) {
    if (e instanceof ConflictError) return Response.json({ error: e.message }, { status: 409 });
    return errorResponse(e);
  }
}
