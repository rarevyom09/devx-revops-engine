import { db, errorResponse, must } from "@/lib/db";
import { DEMO_TODAY, dealTotal, type DealLite } from "@/lib/onboarding-validate";

type DealOut = DealLite & { id: string; name: string; owner: { name: string } | null; partner: string | null };
type BriefOut = { id: string; deal_id: string; status: "draft" | "approved" };
type InvoiceOut = { deal_id: string };

// Approved deals (the `deals` table only holds human-approved records) with
// their brief (approved wins over draft) and invoices.
export async function GET() {
  try {
    const [deals, briefs, invoices] = await Promise.all([
      db()
        .from("deals")
        .select("id,name,deal_type,amount,term_months,close_date,partner,owner_id,owner:people(name)")
        .order("close_date")
        .then(must) as unknown as Promise<DealOut[]>,
      db().from("onboarding_briefs").select("*").then(must) as Promise<BriefOut[]>,
      db()
        .from("invoices")
        .select("id,deal_id,milestone,amount,raised_on,variable_pay_at_stake")
        .order("raised_on")
        .then(must) as Promise<InvoiceOut[]>,
    ]);
    const out = deals.map((d) => {
      const mine = briefs.filter((b) => b.deal_id === d.id);
      const brief = mine.find((b) => b.status === "approved") ?? mine.find((b) => b.status === "draft") ?? null;
      const amount = Number(d.amount);
      return {
        ...d,
        amount,
        total: dealTotal({ ...d, amount }),
        brief_status: brief?.status ?? "none",
        brief,
        invoices: invoices.filter((i) => i.deal_id === d.id),
      };
    });
    return Response.json({ today: DEMO_TODAY, deals: out });
  } catch (e) {
    return errorResponse(e);
  }
}
