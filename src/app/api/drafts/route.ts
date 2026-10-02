import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";

// POST {id, status}: a human marks an auto-drafted follow-up as sent or dismissed.
const Body = z.object({ id: z.uuid(), status: z.enum(["sent", "dismissed"]) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    must(await db().from("action_drafts").update({ status: parsed.data.status, updated_at: new Date().toISOString() }).eq("id", parsed.data.id));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
