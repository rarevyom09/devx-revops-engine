import "server-only";
import { generateJSON } from "@/lib/claude";
import { db, must } from "@/lib/db";
import {
  OneTimeBriefSchema,
  RecurringBriefSchema,
  SYSTEM_PROMPT,
  buildUserPrompt,
  loadDeal,
  saveDraft,
} from "@/lib/onboarding";
import { DEMO_TODAY, recurringSchedule, templateMilestones, type Milestone } from "@/lib/onboarding-validate";

// Shared by the Draft button and the auto-brief trigger.
export async function draftBrief(dealId: string) {
  const today = DEMO_TODAY;
  const deal = await loadDeal(dealId);
  if (!deal) return { status: "not_found" as const };

  const approved = must(
    await db().from("onboarding_briefs").select("id").eq("deal_id", deal.id).eq("status", "approved"),
  ) as { id: string }[];
  if (approved.length) return { status: "approved" as const };

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
    return {
      status: "ai_error" as const,
      ai_error: { reason: ai.reason, detail: ai.detail },
      template: {
        scope_summary: "",
        deliverables: [],
        success_criteria: [],
        risks_and_assumptions: [],
        open_questions: [],
        milestones: templateMilestones(deal, today),
      },
    };
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
  return { status: "ok" as const, brief, deal_name: deal.name };
}
