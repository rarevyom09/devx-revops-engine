import { after } from "next/server";
import { z } from "zod";
import { autoAnalyse } from "@/lib/automation";
import { CASES, caseStatus } from "@/lib/cases";
import { errorResponse } from "@/lib/db";
import { loadSnapshot } from "@/lib/snapshot";

// GET: every case with live step status. POST {key}: load (or restart) a case.
export async function GET() {
  try {
    const s = await loadSnapshot();
    return Response.json({ cases: CASES.map((c) => caseStatus(c, s)) });
  } catch (e) {
    return errorResponse(e);
  }
}

export const maxDuration = 60;

const Body = z.object({ key: z.string() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const def = parsed.success ? CASES.find((c) => c.key === parsed.data.key) : undefined;
  if (!def) return Response.json({ error: "unknown case" }, { status: 400 });
  try {
    await def.load();
    // Loading a case is a deal arriving: same auto-analyse trigger as ingest.
    if (def.rawId) after(() => autoAnalyse([def.rawId!]));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
