import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/db";
import { loadSnapshot } from "@/lib/snapshot";
import { computeValue } from "@/lib/value";

// GET /api/value?asOf=YYYY-MM-DD: pain -> value scorecard from live data.
export async function GET(req: NextRequest) {
  const asOf = req.nextUrl.searchParams.get("asOf") ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return Response.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  try {
    return Response.json(await computeValue(await loadSnapshot(asOf)));
  } catch (e) {
    return errorResponse(e);
  }
}
