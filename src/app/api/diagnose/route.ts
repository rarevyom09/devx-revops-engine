import type { NextRequest } from "next/server";
import { db, errorResponse } from "@/lib/db";
import { groupLeaks, type ActionDraft, type LeakItem } from "@/lib/diagnose";
import { loadSnapshot } from "@/lib/snapshot";

// GET /api/diagnose?asOf=: leaks grouped by type, ranked by money at stake.
export async function GET(req: NextRequest) {
  const asOf = req.nextUrl.searchParams.get("asOf") ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return Response.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  try {
    const s = await loadSnapshot(asOf);
    const { data: drafts } = await db().from("action_drafts").select("id,alert_id,status,assist,unverified_amounts,detail,created_at");
    const draftFor = new Map(((drafts ?? []) as (ActionDraft & { alert_id: string })[]).map((d) => [d.alert_id, d]));
    const items: LeakItem[] = s.alerts.map((a) => {
      const inv = a.ref.kind === "invoice" ? s.evals.find((e) => e.id === a.ref.id) : undefined;
      return {
        ...a,
        deal_name: s.deals.find((d) => d.id === a.ref.deal_id)?.name ?? null,
        milestone: inv?.milestone ?? null,
        outstanding: inv?.outstanding ?? null,
        draft: draftFor.get(a.id) ?? null,
      };
    });
    const groups = groupLeaks(items);
    return Response.json({
      asOf: s.asOf,
      groups,
      totals: {
        atStake: groups.filter((g) => g.severity !== "info").reduce((x, g) => x + g.impact, 0),
        critical: items.filter((a) => a.severity === "critical").length,
        warning: items.filter((a) => a.severity === "warning").length,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
