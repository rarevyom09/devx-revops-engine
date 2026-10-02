import { after } from "next/server";
import { z } from "zod";
import { analyseRawDeal } from "@/lib/analyse";
import { db, errorResponse, must } from "@/lib/db";
import { RepAnswers } from "@/lib/integrity";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { aiUsage } from "@/lib/claude";

export const maxDuration = 60;

const Body = z.object({ analysis_id: z.uuid(), rep_id: z.uuid(), answers: RepAnswers.min(1) });

// The rep answers the agent's questions. Answers are saved for audit, ops is told,
// and (if automation is on) the deal is re-analysed with the answers.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  const { analysis_id, rep_id, answers } = parsed.data;
  try {
    const a = must(await db().from("deal_analyses").select("id,raw_deal_id,rep_answers").eq("id", analysis_id).single());
    const raw = must(await db().from("raw_deals").select("id,owner_id,status").eq("id", a.raw_deal_id).single());
    if (raw.owner_id !== rep_id) return Response.json({ error: "Only the deal's owner can answer here" }, { status: 403 });
    if (raw.status === "approved") return Response.json({ error: "Deal already approved" }, { status: 409 });
    const rep = must(await db().from("people").select("name").eq("id", rep_id).single());

    // Merge with earlier answers (same question index wins with the new answer).
    const prior = ((a.rep_answers ?? []) as z.infer<typeof RepAnswers>).filter((p) => !answers.some((n) => n.index === p.index));
    const merged = [...prior, ...answers.map((x) => ({ ...x, answered_by: rep.name }))].sort((x, y) => x.index - y.index);
    must(await db().from("deal_analyses").update({ rep_answers: merged }).eq("id", analysis_id));

    await notify([{
      kind: "rep_answered",
      title: `${rep.name} answered ${answers.length} question${answers.length === 1 ? "" : "s"}`,
      body: answers.map((x) => `${x.question} → ${x.answer}`).join(" · ").slice(0, 400),
      href: `/pipeline?raw=${raw.id}`,
      owner_id: null,
    }]);

    const settings = await getSettings();
    const usage = await aiUsage();
    const canRerun = settings.auto_analyse && usage.used != null && usage.limit - usage.used > settings.ai_reserve;
    if (canRerun) {
      after(async () => {
        const r = await analyseRawDeal(raw.id, merged);
        if (r.ok) {
          await notify([{
            kind: "ai_analysed",
            title: `Re-analysed with ${rep.name}'s answers: ${r.analysis.confidence} confidence`,
            body: `${r.analysis.validator_flags.flags.length} failed check(s). Ready for ops approval.`,
            href: `/pipeline?raw=${raw.id}`,
            owner_id: null,
            dedupe_key: `analysed:${r.analysis.id}`,
          }]);
        }
      });
    }
    return Response.json({ ok: true, rerun: canRerun });
  } catch (e) {
    return errorResponse(e);
  }
}
