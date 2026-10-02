import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { db } from "./db";

// Model is swappable via env (HANDOFF §5). Haiku 4.5 is the cheapest current
// model with structured outputs; the deterministic validators backstop it.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
// Hard cap on total Claude calls for the project, enforced via the ai_calls table.
export const AI_CALL_LIMIT = Number(process.env.AI_CALL_LIMIT || 100);

let client: Anthropic | null = null;
function getClient() {
  // maxRetries 0: a retry is another billed call that would bypass the budget.
  if (!client) client = new Anthropic({ maxRetries: 0 }); // reads ANTHROPIC_API_KEY
  return client;
}

export type AIFailure = {
  ok: false;
  reason: "not_configured" | "budget_exhausted" | "refusal" | "invalid_output" | "truncated" | "api_error";
  detail: string;
};
export type AISuccess<T> = { ok: true; data: T; model: string };
export type AIResult<T> = AISuccess<T> | AIFailure;

export async function aiUsage() {
  const { count, error } = await db().from("ai_calls").select("*", { count: "exact", head: true });
  return { used: error ? null : (count ?? 0), limit: AI_CALL_LIMIT, error: error?.message ?? null };
}

/**
 * Reserve one call from the budget before calling Claude. Fails closed: if the
 * ledger can't be read or written, no call is made. Two concurrent requests at
 * the limit may both be refused, which is the safe direction.
 */
async function reserveCall(route: string): Promise<{ ok: true; id: string } | AIFailure> {
  const ins = await db().from("ai_calls").insert({ route, model: MODEL }).select("id").single();
  if (ins.error) {
    return { ok: false, reason: "not_configured", detail: `AI call ledger unavailable (run supabase/002_ai_calls.sql): ${ins.error.message}` };
  }
  const { count, error } = await db().from("ai_calls").select("*", { count: "exact", head: true });
  if (error || (count ?? Infinity) > AI_CALL_LIMIT) {
    await db().from("ai_calls").delete().eq("id", ins.data.id);
    return { ok: false, reason: "budget_exhausted", detail: `AI call budget of ${AI_CALL_LIMIT} reached` };
  }
  return { ok: true, id: ins.data.id };
}

async function settle(id: string, status: "ok" | "failed", extra: { input_tokens?: number; output_tokens?: number; detail?: string }) {
  await db().from("ai_calls").update({ status, ...extra }).eq("id", id);
}

/**
 * One structured-output call. Never throws: every failure becomes an AIFailure
 * so callers can degrade to manual entry instead of silently guessing.
 * The schema is enforced by the API (structured outputs) and re-validated by
 * the SDK with Zod; callers still run their own deterministic checks on top.
 */
export async function generateJSON<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  route?: string;
  maxTokens?: number;
}): Promise<AIResult<z.infer<S>>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "not_configured", detail: "ANTHROPIC_API_KEY is not set" };
  }
  const slot = await reserveCall(opts.route ?? "unknown");
  if (!slot.ok) return slot;

  const fail = async (f: AIFailure, usage?: { input_tokens: number; output_tokens: number }) => {
    await settle(slot.id, "failed", { ...usage, detail: `${f.reason}: ${f.detail}`.slice(0, 500) });
    return f;
  };

  try {
    const res = await getClient().messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { format: zodOutputFormat(opts.schema) },
    });
    const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };

    if (res.stop_reason === "refusal") {
      return fail({ ok: false, reason: "refusal", detail: res.stop_details?.explanation ?? "Model declined this request" }, usage);
    }
    if (res.stop_reason === "max_tokens") {
      return fail({ ok: false, reason: "truncated", detail: "Output hit max_tokens before completing" }, usage);
    }
    if (res.parsed_output == null) {
      return fail({ ok: false, reason: "invalid_output", detail: "Model output did not match the schema" }, usage);
    }
    await settle(slot.id, "ok", usage);
    return { ok: true, data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return fail({ ok: false, reason: "not_configured", detail: "Anthropic API key was rejected" });
    }
    if (e instanceof Anthropic.APIError) {
      return fail({ ok: false, reason: "api_error", detail: `API error ${e.status}: ${e.message}` });
    }
    // Zod re-validation failure or network error.
    return fail({ ok: false, reason: "invalid_output", detail: e instanceof Error ? e.message : String(e) });
  }
}

/** Wrap untrusted text so the model treats it as data (prompt-injection guard). */
export function asData(tag: string, text: string) {
  // Neutralise any attempt to close our tag from inside the data.
  const safe = text.replaceAll(`</${tag}>`, `<\\/${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}
