import { z } from "zod";
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

const Body = z.object({ key: z.string() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const def = parsed.success ? CASES.find((c) => c.key === parsed.data.key) : undefined;
  if (!def) return Response.json({ error: "unknown case" }, { status: 400 });
  try {
    await def.load();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
