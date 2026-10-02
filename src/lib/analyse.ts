import "server-only";
import { asData, generateJSON, MODEL, type AIFailure } from "./claude";
import { db, must } from "./db";
import { ensureQuestions, IntegrityOutput, systemPrompt, validateProposal, type RepAnswer } from "./integrity";

export type AnalyseResult =
  | { ok: true; analysis: { id: string; confidence: string; output: IntegrityOutput; validator_flags: { flags: unknown[] } } }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; ai: AIFailure };

// One integrity-agent run: Claude proposes, the validator re-checks, the run is stored for audit.
// Shared by the Analyse button and the auto-analyse trigger.
export async function analyseRawDeal(rawDealId: string, answers: RepAnswer[] = []): Promise<AnalyseResult> {
  const raw = must(await db().from("raw_deals").select("id,raw_text,status").eq("id", rawDealId).single());
  if (raw.status === "approved") return { ok: false, conflict: true, error: "Already approved; re-analysis is disabled" };

  const today = new Date().toISOString().slice(0, 10);
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
  if (!ai.ok) return { ok: false, ai };

  // Only code may tag a question "added by checks": drop the tag if the model set it.
  const fromModel = { ...ai.data, ambiguities: ai.data.ambiguities.map((q) => ({ question: q.question, field: q.field, record_index: q.record_index })) };
  const output = ensureQuestions(fromModel, answers);
  const validation = validateProposal(raw.raw_text, output, today, answers);
  const analysis = must(
    await db()
      .from("deal_analyses")
      .insert({
        raw_deal_id: raw.id,
        model: ai.model ?? MODEL,
        output,
        confidence: validation.confidence,
        validator_flags: { ...validation, today, answers_used: answers.length },
      })
      .select()
      .single(),
  );
  must(await db().from("raw_deals").update({ status: "analysed" }).eq("id", raw.id));
  return { ok: true, analysis };
}
