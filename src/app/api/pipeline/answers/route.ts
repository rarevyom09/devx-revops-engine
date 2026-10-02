import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";
import { RepAnswers } from "@/lib/integrity";

const Body = z.object({ analysis_id: z.uuid(), answers: RepAnswers });

// Save the rep's answers on the analysis they respond to (audit trail).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const res = await db()
      .from("deal_analyses")
      .update({ rep_answers: parsed.data.answers })
      .eq("id", parsed.data.analysis_id)
      .select("id")
      .single();
    if (res.error?.message.includes("rep_answers")) {
      return Response.json({ error: "Answers column missing: run supabase/003_rep_answers.sql" }, { status: 503 });
    }
    must(res);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
