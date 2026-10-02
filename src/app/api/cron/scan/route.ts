import { autoDraftFollowUps } from "@/lib/automation";
import { errorResponse } from "@/lib/db";
import { scanLeaks } from "@/lib/notify";
import { loadSnapshot } from "@/lib/snapshot";

export const maxDuration = 60;

// Daily scheduled leak scan (vercel.json cron). Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const snap = await loadSnapshot();
    await scanLeaks(snap);
    await autoDraftFollowUps(snap);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
