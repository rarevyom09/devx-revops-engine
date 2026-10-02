import { z } from "zod";
import { asData, generateJSON, MODEL } from "@/lib/claude";
import { db, errorResponse, must } from "@/lib/db";
import { IntegrityOutput, RepAnswers, systemPrompt, validateProposal } from "@/lib/integrity";

const Body = z.object({ raw_deal_id: z.uuid(), answers: RepAnswers.optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "raw_deal_id required" }, { status: 400 });
  try {
    const raw = must(
      await db().from("raw_deals").select("id,raw_text,status").eq("id", parsed.data.raw_deal_id).single(),
    );
    if (raw.status === "approved") {
      return Response.json({ error: "Already approved; re-analysis is disabled" }, { status: 409 });
    }
    const today = new Date().toISOString().slice(0, 10);
    const answers = parsed.data.answers ?? [];
    const ai = await generateJSON({
      schema: IntegrityOutput,
      system: systemPrompt(today),
      user: [
        asData("deal_text", raw.raw_text),
        ...(answers.length
          ? [asData("rep_answers", JSON.stringify(answers.map(({ question, answer }) => ({ question, answer })), null, 2))]
          : []),
      ].join("\n\n"),
      route: "pipeline.analyse",
    });

    // AI failed: never guess. The UI switches to manual entry.
    if (!ai.ok) return Response.json({ ai_unavailable: true, reason: ai.reason, detail: ai.detail });

    const validation = validateProposal(raw.raw_text, ai.data, today, answers);
    const analysis = must(
      await db()
        .from("deal_analyses")
        .insert({
          raw_deal_id: raw.id,
          model: ai.model ?? MODEL,
          output: ai.data,
          confidence: validation.confidence,
          validator_flags: { ...validation, today, answers_used: answers.length },
        })
        .select()
        .single(),
    );
    must(await db().from("raw_deals").update({ status: "analysed" }).eq("id", raw.id));
    return Response.json({ analysis });
  } catch (e) {
    return errorResponse(e);
  }
}
