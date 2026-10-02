import { after, type NextRequest } from "next/server";
import { autoDraftFollowUps } from "@/lib/automation";
import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";
import { scanLeaks } from "@/lib/notify";
import { loadSnapshot } from "@/lib/snapshot";

export const maxDuration = 60;

// GET ?owner=<id>: run the leak scan (dedupes), then return the latest notifications.
export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner");
  try {
    const snap = await loadSnapshot();
    await scanLeaks(snap);
    // New leaks that need a message get a drafted follow-up in the background.
    after(() => autoDraftFollowUps(snap));
    let q = db()
      .from("notifications")
      .select("id,kind,severity,title,body,href,owner_id,read_at,created_at,owner:people(name)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (owner) q = q.or(`owner_id.eq.${owner},owner_id.is.null`);
    const items = must(await q);
    return Response.json({ items, unread: items.filter((n) => !n.read_at).length });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.union([z.object({ action: z.literal("read"), id: z.uuid() }), z.object({ action: z.literal("read_all") })]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const now = new Date().toISOString();
    const q = db().from("notifications").update({ read_at: now }).is("read_at", null);
    must(await (parsed.data.action === "read" ? q.eq("id", parsed.data.id) : q));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
