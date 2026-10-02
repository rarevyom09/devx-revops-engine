import { z } from "zod";
import { assistDeal } from "@/lib/assist";
import { errorResponse } from "@/lib/db";

const Body = z.object({ deal_id: z.uuid() });

// POST {deal_id}: on-demand AI next step for one approved deal. Never persisted.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "deal_id (uuid) required" }, { status: 400 });
  try {
    const r = await assistDeal(parsed.data.deal_id);
    if (r.ok) return Response.json({ assist: r.assist, unverified_amounts: r.unverified_amounts, model: r.model });
    if (r.notFound) return Response.json({ error: "Deal not found (only approved deals)." }, { status: 404 });
    return Response.json({ ai_error: { reason: r.ai.reason, detail: r.ai.detail } });
  } catch (e) {
    return errorResponse(e);
  }
}
