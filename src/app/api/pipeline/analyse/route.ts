import { z } from "zod";
import { analyseRawDeal } from "@/lib/analyse";
import { errorResponse } from "@/lib/db";
import { RepAnswers } from "@/lib/integrity";

const Body = z.object({ raw_deal_id: z.uuid(), answers: RepAnswers.optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "raw_deal_id required" }, { status: 400 });
  try {
    const r = await analyseRawDeal(parsed.data.raw_deal_id, parsed.data.answers ?? []);
    if (r.ok) return Response.json({ analysis: r.analysis });
    if (r.conflict) return Response.json({ error: r.error }, { status: 409 });
    // AI failed: never guess. The UI switches to manual entry.
    return Response.json({ ai_unavailable: true, reason: r.ai.reason, detail: r.ai.detail });
  } catch (e) {
    return errorResponse(e);
  }
}
