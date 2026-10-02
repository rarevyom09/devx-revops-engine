import type { NextRequest } from "next/server";
import { db, errorResponse, must } from "@/lib/db";
import { normalizeQuestions } from "@/lib/integrity";

// GET ?rep=<person id>: the rep's own deals with what the AI understood and its open questions.
export async function GET(req: NextRequest) {
  const rep = req.nextUrl.searchParams.get("rep");
  try {
    const reps = must(await db().from("people").select("id,name,entity").eq("role", "consulting_owner").order("name"));
    if (!rep) return Response.json({ reps, deals: [] });
    const raw = must(
      await db().from("raw_deals").select("id,raw_text,status,created_at").eq("owner_id", rep).neq("status", "rejected").order("created_at", { ascending: false }),
    );
    const ids = raw.map((r) => r.id);
    const [analyses, deals] = await Promise.all([
      ids.length ? db().from("deal_analyses").select("*").in("raw_deal_id", ids).order("created_at", { ascending: false }).then(must) : [],
      ids.length ? db().from("deals").select("raw_deal_id,name,deal_type,amount,term_months,close_date").in("raw_deal_id", ids).then(must) : [],
    ]);
    const out = raw.map((r) => {
      const a = analyses.find((x) => x.raw_deal_id === r.id) ?? null;
      const questions = a ? normalizeQuestions(a.output?.ambiguities) : [];
      const answered = new Map(((a?.rep_answers ?? []) as { index: number; answer: string; answered_by?: string }[]).map((x) => [x.index, x]));
      return {
        ...r,
        analysis: a && {
          id: a.id,
          confidence: a.confidence,
          records: a.output?.records ?? [],
          partner: a.output?.partner ?? null,
          reasoning: a.output?.reasoning ?? "",
          rep_label_conflict: a.output?.rep_label_conflict ?? null,
          is_blended: !!a.output?.is_blended,
          answers_used: a.validator_flags?.answers_used ?? 0,
        },
        questions: questions.map((q, i) => ({ ...q, index: i, answer: answered.get(i)?.answer ?? null, answered_by: answered.get(i)?.answered_by ?? null })),
        deals: deals.filter((d) => d.raw_deal_id === r.id),
      };
    });
    return Response.json({ reps, deals: out });
  } catch (e) {
    return errorResponse(e);
  }
}
