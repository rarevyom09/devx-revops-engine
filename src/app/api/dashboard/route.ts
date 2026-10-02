import type { NextRequest } from "next/server";
import { DEMO_TODAY, isISODate } from "@/lib/clawback";
import type { DashboardData, Entity } from "@/lib/dashboard";
import { db, errorResponse, must } from "@/lib/db";
import { loadSnapshot } from "@/lib/snapshot";

type Person = { id: string; name: string; role: string | null; entity: Entity | null };

// GET /api/dashboard?asOf=YYYY-MM-DD: chart-ready slices of the snapshot.
// Filters are applied client-side (src/lib/dashboard.ts).
export async function GET(req: NextRequest) {
  try {
    const param = req.nextUrl.searchParams.get("asOf");
    if (param && !isISODate(param)) return Response.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
    const asOf = param ?? DEMO_TODAY;

    const [s, people] = await Promise.all([
      loadSnapshot(asOf),
      // Snapshot's people map carries names only; entity drives the IN/SG filter.
      db().from("people").select("id,name,role,entity").then(must) as Promise<Person[]>,
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const dealOwner = new Map(s.deals.map((d) => [d.id, d.owner_id]));
    const rawOwner = new Map(s.raw.map((r) => [r.id, r.owner_id]));
    const evalOf = new Map(s.evals.map((e) => [e.id, e]));
    const paid = (invoiceId: string) =>
      s.payments.filter((p) => p.invoice_id === invoiceId && p.paid_on <= asOf).reduce((t, p) => t + Number(p.amount), 0);
    const invoiceDeal = new Map(s.invoices.map((i) => [i.id, i.deal_id]));

    const ownerIds = new Set([...s.deals.map((d) => d.owner_id), ...s.raw.map((r) => r.owner_id)].filter((x): x is string => !!x));
    const data: DashboardData = {
      asOf,
      owners: [...ownerIds]
        .map((id) => ({ id, name: person.get(id)?.name ?? "Unknown", entity: person.get(id)?.entity ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      practices: [...new Set(s.deals.flatMap((d) => Object.keys(d.practice_split ?? {})))].sort(),
      deals: s.deals.map((d) => ({
        id: d.id,
        name: d.name,
        deal_type: d.deal_type,
        amount: d.amount,
        term_months: d.term_months,
        total: d.total,
        arr: d.deal_type === "recurring" ? d.amount * 12 : null,
        close_date: d.close_date,
        owner_id: d.owner_id,
        owner: d.owner_id ? (person.get(d.owner_id)?.name ?? null) : null,
        entity: d.owner_id ? (person.get(d.owner_id)?.entity ?? null) : null,
        practices: Object.entries(d.practice_split ?? {}).filter(([, v]) => Number(v) > 0).map(([k]) => k),
      })),
      invoices: s.invoices.map((i) => {
        const e = evalOf.get(i.id);
        return {
          id: i.id,
          deal_id: i.deal_id,
          deal: i.deals?.name ?? "—",
          milestone: i.milestone,
          amount: Number(i.amount),
          raised_on: i.raised_on,
          raised: !!e,
          owner_id: i.owner_id,
          owner: i.people?.name ?? null,
          paid_to_date: paid(i.id),
          status: e?.status ?? null,
          deadline: e?.deadline ?? null,
          days_left: e?.days_left ?? null,
          at_stake: Number(i.variable_pay_at_stake ?? 0),
          realised: e?.realised_clawback ?? 0,
          projected: e?.projected_exposure ?? 0,
        };
      }),
      payments: s.payments
        .filter((p) => p.paid_on <= asOf && invoiceDeal.has(p.invoice_id))
        .map((p) => ({ invoice_id: p.invoice_id, deal_id: invoiceDeal.get(p.invoice_id)!, amount: Number(p.amount), paid_on: p.paid_on })),
      margins: s.margins.map((m) => ({
        deal_id: m.deal_id,
        name: m.name,
        price: m.price,
        hours: m.hours,
        cost: m.cost,
        blended_rate: m.blended_rate,
        margin_pct: m.margin_pct,
      })),
      alerts: s.alerts.map((a) => ({
        id: a.id,
        stage: a.stage,
        severity: a.severity,
        title: a.title,
        subject: a.subject,
        impact: a.impact,
        href: a.href,
        deal_id: a.ref.deal_id,
        owner_id: a.ref.deal_id ? (dealOwner.get(a.ref.deal_id) ?? null) : a.ref.kind === "raw" ? (rawOwner.get(a.ref.id) ?? null) : null,
      })),
    };
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
