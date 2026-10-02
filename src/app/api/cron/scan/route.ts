import { errorResponse } from "@/lib/db";
import { scanLeaks } from "@/lib/notify";
import { loadSnapshot } from "@/lib/snapshot";

// Daily scheduled leak scan (vercel.json cron). Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await scanLeaks(await loadSnapshot());
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
