import type { NextRequest } from "next/server";
import { db, errorResponse, must } from "@/lib/db";
import {
  AT_RISK_WINDOW_DAYS,
  DEMO_TODAY,
  QUARTER_ASSUMPTION,
  evaluateAll,
  isISODate,
  rollupByOwner,
  type InvoiceInput,
  type PaymentInput,
} from "@/lib/clawback";

type InvoiceRow = {
  id: string;
  milestone: string;
  amount: number;
  raised_on: string;
  owner_id: string | null;
  variable_pay_at_stake: number | null;
  deals: { name: string } | null;
  people: { name: string } | null;
};

// GET /api/clawback?asOf=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const param = req.nextUrl.searchParams.get("asOf");
    if (param && !isISODate(param)) return Response.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
    const asOf = param ?? DEMO_TODAY;

    const [invRows, payRows] = await Promise.all([
      db()
        .from("invoices")
        .select("id,milestone,amount,raised_on,owner_id,variable_pay_at_stake,deals(name),people(name)")
        .then(must) as Promise<InvoiceRow[]>,
      db().from("payments").select("invoice_id,amount,paid_on").then(must) as Promise<PaymentInput[]>,
    ]);

    const invoices: InvoiceInput[] = invRows.map((r) => ({
      id: r.id,
      milestone: r.milestone,
      amount: Number(r.amount),
      raised_on: r.raised_on,
      owner_id: r.owner_id,
      variable_pay_at_stake: r.variable_pay_at_stake == null ? null : Number(r.variable_pay_at_stake),
      deal_name: r.deals?.name ?? null,
      owner_name: r.people?.name ?? null,
    }));
    const rows = evaluateAll(invoices, payRows.map((p) => ({ ...p, amount: Number(p.amount) })), asOf);

    return Response.json({
      asOf,
      assumptions: { quarters: QUARTER_ASSUMPTION, atRiskWindowDays: AT_RISK_WINDOW_DAYS },
      invoices: rows,
      owners: rollupByOwner(rows),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
