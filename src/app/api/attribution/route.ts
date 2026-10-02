import type { NextRequest } from "next/server";
import { attribute } from "@/lib/attribution";
import { errorResponse } from "@/lib/db";
import { loadSnapshot } from "@/lib/snapshot";

// GET /api/attribution?asOf=: double-bubble credit (owner 100% + practice split).
export async function GET(req: NextRequest) {
  const asOf = req.nextUrl.searchParams.get("asOf") ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return Response.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  try {
    const s = await loadSnapshot(asOf);
    const deals = s.deals.map((d) => ({
      id: d.id,
      name: d.name,
      owner_name: d.owner_id ? (s.people.get(d.owner_id) ?? null) : null,
      practice_split: d.practice_split,
    }));
    return Response.json({ asOf: s.asOf, ...attribute(deals, s.evals, s.asOf) });
  } catch (e) {
    return errorResponse(e);
  }
}
