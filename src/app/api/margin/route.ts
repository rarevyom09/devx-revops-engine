import { db, errorResponse, must } from "@/lib/db";
import { computeMargin, sumHours, type DealInput, type Rates } from "@/lib/margin";

type DealRow = Omit<DealInput, "owner_name"> & { people: { name: string } | null };

// GET /api/margin: per-deal hours, rates, and baseline margin at the default target.
export async function GET() {
  try {
    const [dealRows, rateRows, sheetRows] = await Promise.all([
      db().from("deals").select("id,name,deal_type,amount,term_months,people(name)").order("name").then(must) as Promise<DealRow[]>,
      db().from("rates").select("location,hourly_rate").then(must) as Promise<{ location: string; hourly_rate: number }[]>,
      db().from("timesheets").select("deal_id,location,hours").then(must) as Promise<
        { deal_id: string; location: string; hours: number }[]
      >,
    ]);

    const rates: Rates = { IN: 0, SG: 0 };
    for (const r of rateRows) if (r.location === "IN" || r.location === "SG") rates[r.location] = Number(r.hourly_rate);
    const missingRates = (["IN", "SG"] as const).filter((l) => !rates[l]);

    const deals = dealRows.map((d) => {
      const deal: DealInput = {
        id: d.id,
        name: d.name,
        deal_type: d.deal_type,
        amount: Number(d.amount),
        term_months: d.term_months,
        owner_name: d.people?.name ?? null,
      };
      const hours = sumHours(sheetRows.filter((t) => t.deal_id === d.id));
      return { ...deal, ...computeMargin(deal, hours, rates) };
    });

    return Response.json({ rates, missingRates, deals });
  } catch (e) {
    return errorResponse(e);
  }
}
