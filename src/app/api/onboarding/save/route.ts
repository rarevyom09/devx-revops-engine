import { z } from "zod";
import { errorResponse } from "@/lib/db";
import { BriefBody, ConflictError, MilestonesBody, loadDeal, saveDraft } from "@/lib/onboarding";
import { DEMO_TODAY } from "@/lib/onboarding-validate";

const Body = z.object({
  deal_id: z.uuid(),
  brief: BriefBody,
  milestones: MilestonesBody,
  // "ai" = an AI draft the human edited (model kept); "manual" = typed by a human.
  source: z.enum(["ai", "manual"]).default("manual"),
  model: z.string().nullable().default(null),
  ai_error: z.object({ reason: z.string(), detail: z.string() }).nullable().default(null),
});

// POST: save (create or replace) the deal's draft brief. Validator re-runs server-side.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  try {
    const deal = await loadDeal(b.deal_id);
    if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
    const brief = await saveDraft(
      deal,
      b.brief,
      b.milestones,
      { source: b.source, model: b.source === "ai" ? b.model : null, ai_error: b.ai_error },
      DEMO_TODAY,
    );
    return Response.json({ brief });
  } catch (e) {
    if (e instanceof ConflictError) return Response.json({ error: e.message }, { status: 409 });
    return errorResponse(e);
  }
}
