import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";
import { PracticeSplit } from "@/lib/integrity";

// Small, explicit fixes run from the Diagnose panel. Human-triggered only.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_registered"), deal_id: z.uuid() }),
  z.object({ action: z.literal("set_practice"), deal_id: z.uuid(), practice_split: PracticeSplit }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  const b = parsed.data;
  try {
    const deal = must(await db().from("deals").select("id,partner,partner_flags").eq("id", b.deal_id).single());
    if (b.action === "mark_registered") {
      if (!deal.partner) return Response.json({ error: "Deal has no partner" }, { status: 400 });
      must(await db().from("deals").update({ partner_flags: { ...(deal.partner_flags ?? {}), deal_registered: true } }).eq("id", b.deal_id));
    } else {
      must(await db().from("deals").update({ practice_split: b.practice_split }).eq("id", b.deal_id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
