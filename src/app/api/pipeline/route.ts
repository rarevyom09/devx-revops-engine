import { db, errorResponse, must } from "@/lib/db";

// Raw-deal queue with owner, latest analysis and any deals created from it.
export async function GET() {
  try {
    const [raw, analyses, deals] = await Promise.all([
      db().from("raw_deals").select("id,source,raw_text,status,created_at,owner:people(name,entity)").order("created_at").then(must),
      db().from("deal_analyses").select("*").order("created_at", { ascending: false }).then(must),
      db().from("deals").select("id,raw_deal_id,name,deal_type,amount,term_months,close_date,partner,approved_by,approved_at").not("raw_deal_id", "is", null).then(must),
    ]);
    const queue = raw.map((r) => {
      const mine = analyses.filter((a) => a.raw_deal_id === r.id);
      return {
        ...r,
        latest_analysis: mine[0] ?? null,
        analysis_count: mine.length,
        deals: deals.filter((d) => d.raw_deal_id === r.id),
      };
    });
    return Response.json({ queue });
  } catch (e) {
    return errorResponse(e);
  }
}
