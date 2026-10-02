import { after } from "next/server";
import { z } from "zod";
import { autoBrief } from "@/lib/automation";
import { db, errorResponse, must } from "@/lib/db";
import { ApprovedRecord, PracticeSplit, RepAnswers } from "@/lib/integrity";

const Partner = z
  .object({
    name: z.string().trim().min(1),
    type: z.string(),
    mdf_amount: z.number().nullable(),
    deal_registered: z.boolean().nullable(),
  })
  .nullable();

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    raw_deal_id: z.uuid(),
    analysis_id: z.uuid().nullable(),
    approved_by: z.string().trim().min(1, "approver name required"),
    records: z.array(ApprovedRecord).min(1),
    partner: Partner,
    practice_split: PracticeSplit.nullable(),
    answers: RepAnswers.default([]),
  }),
  z.object({ action: z.literal("reject"), raw_deal_id: z.uuid() }),
]);

export const maxDuration = 60;

// Human decision. Only this route writes to `deals`.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const b = parsed.data;
  try {
    const raw = must(
      await db().from("raw_deals").select("id,status,owner_id").eq("id", b.raw_deal_id).single(),
    );
    if (raw.status === "approved") return Response.json({ error: "Already approved" }, { status: 409 });

    if (b.action === "reject") {
      must(await db().from("raw_deals").update({ status: "rejected" }).eq("id", raw.id));
      return Response.json({ ok: true });
    }

    if (b.analysis_id && b.answers.length) {
      const saved = await db().from("deal_analyses").update({ rep_answers: b.answers }).eq("id", b.analysis_id);
      if (saved.error) return Response.json({ error: `Could not save rep answers: ${saved.error.message}` }, { status: 503 });
    }

    const names = b.records.map((r) => r.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      return Response.json({ error: "Record names must be unique" }, { status: 400 });
    }
    const now = new Date().toISOString();
    // MDF belongs to the deal, not each record: carry it on one record only
    // (the one-time record if there is one) so it isn't counted twice.
    const mdfIndex = Math.max(0, b.records.findIndex((r) => r.deal_type === "one_time"));
    const rows = b.records.map((r, i) => ({
      raw_deal_id: raw.id,
      name: r.name,
      deal_type: r.deal_type,
      amount: r.amount,
      term_months: r.deal_type === "recurring" ? r.term_months : null,
      close_date: r.close_date,
      owner_id: raw.owner_id,
      practice_split: b.practice_split,
      partner: b.partner?.name ?? null,
      partner_flags: b.partner
        ? {
            type: b.partner.type,
            mdf_amount: i === mdfIndex ? b.partner.mdf_amount : null,
            ...(i !== mdfIndex && b.partner.mdf_amount ? { mdf_on: b.records[mdfIndex].name } : {}),
            deal_registered: b.partner.deal_registered,
            needs_review: true,
            analysis_id: b.analysis_id,
          }
        : { analysis_id: b.analysis_id },
      approved_by: b.approved_by,
      approved_at: now,
    }));
    // Single insert => both halves of a split land together or not at all.
    const res = await db().from("deals").insert(rows).select("id,name");
    if (res.error?.code === "23505") {
      return Response.json({ error: "A deal with that name already exists. Rename it (e.g. add a phase)." }, { status: 409 });
    }
    const created = must(res);
    // Approval triggers the onboarding brief draft for each new record.
    after(() => autoBrief(created.map((d) => d.id)));
    must(await db().from("raw_deals").update({ status: "approved" }).eq("id", raw.id));
    return Response.json({ ok: true, deals: created });
  } catch (e) {
    return errorResponse(e);
  }
}
