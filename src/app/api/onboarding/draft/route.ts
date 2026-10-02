import { z } from "zod";
import { draftBrief } from "@/lib/brief-draft";
import { errorResponse } from "@/lib/db";
import { ConflictError } from "@/lib/onboarding";

const Body = z.object({ deal_id: z.uuid() });

// POST {deal_id}: ask Claude for a brief. Success -> validated draft saved.
// Failure -> nothing saved; returns ai_error + a deterministic TEMPLATE for manual entry.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  try {
    const r = await draftBrief(parsed.data.deal_id);
    if (r.status === "not_found") return Response.json({ error: "Deal not found (only approved deals exist in `deals`)." }, { status: 404 });
    if (r.status === "approved") return Response.json({ error: "Brief already approved; it is immutable." }, { status: 409 });
    if (r.status === "ai_error") return Response.json({ ai_error: r.ai_error, template: r.template });
    return Response.json({ brief: r.brief });
  } catch (e) {
    if (e instanceof ConflictError) return Response.json({ error: e.message }, { status: 409 });
    return errorResponse(e);
  }
}
