// Accuracy eval for the Deal Integrity Agent.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/eval-integrity.ts
// Runs the production pipeline (generateJSON -> strip added_by -> ensureQuestions ->
// validateProposal) on labelled deal texts in src/data/eval-deals.ts, with today fixed,
// and no deal/analysis DB writes (only the ai_calls ledger row generateJSON writes).
//
// Four result sets, kept separate:
//   v1_original  first run: old prompt + old checks (frozen; copied from the earlier results file)
//   v1_rescored  the same 18 cached model outputs, re-checked with the current code (0 calls)
//   v2_heldout   6 new cases written after the fixes, current prompt + checks (headline)
//   v2_rerun     the 4 v1 failures re-run with the current prompt (NOT held-out)
// Model outputs are cached per case, so re-running only calls Claude for missing cases
// and re-scoring is free. Hard caps on live calls per phase.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { asData, generateJSON, MODEL } from "../src/lib/claude";
import { db } from "../src/lib/db";
import {
  ensureQuestions, IntegrityOutput, NAME_PATTERN, systemPrompt, validateProposal,
  type Confidence, type QuestionField, type Validation,
} from "../src/lib/integrity";
import { EVAL_CASES, EVAL_CASES_V2, EVAL_TODAY, RERUN_IDS, type EvalCase } from "../src/data/eval-deals";

const ROOT = process.cwd();
const RESULTS = join(ROOT, "src/data/eval-results.json");
const REPORT = join(ROOT, "docs/eval/report.md");
const CACHE = process.env.EVAL_CACHE ||
  "/private/tmp/claude-501/-Users-vyompadalia-Desktop-DEVX-Task/ba389d2d-e6e8-45e1-969f-96ba8c009bc6/scratchpad/eval-cache.json";
const MAX_CALLS_V2 = 12;
const PRICE = { input: 1 / 1e6, output: 5 / 1e6 }; // Haiku 4.5, USD per token

type CachedRun = {
  ok: boolean;
  model: string | null;
  data?: Omit<IntegrityOutput, "excluded_amounts"> & { excluded_amounts?: IntegrityOutput["excluded_amounts"] };
  failure?: { reason: string; detail: string };
  input_tokens: number | null;
  output_tokens: number | null;
  at: string;
};
type Phase = { calls: number; runs: Record<string, CachedRun> };
type Cache = Phase & { v2?: Phase };

const loadCache = (): Cache => (existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { calls: 0, runs: {} });
const saveCache = (c: Cache) => {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c, null, 2));
};

async function lastUsage() {
  const { data } = await db()
    .from("ai_calls")
    .select("input_tokens,output_tokens")
    .eq("route", "eval.integrity")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { input_tokens: data?.input_tokens ?? null, output_tokens: data?.output_tokens ?? null };
}

async function runCase(c: EvalCase): Promise<CachedRun> {
  const ai = await generateJSON({
    schema: IntegrityOutput,
    system: systemPrompt(EVAL_TODAY),
    user: asData("deal_text", c.text),
    route: "eval.integrity",
  });
  const usage = await lastUsage().catch(() => ({ input_tokens: null, output_tokens: null }));
  const at = new Date().toISOString();
  if (!ai.ok) return { ok: false, model: null, failure: { reason: ai.reason, detail: ai.detail }, ...usage, at };
  return { ok: true, model: ai.model, data: ai.data, ...usage, at };
}

// ---------- Scoring ----------

const FIELDS = [
  "record_count", "deal_types", "amounts", "terms", "close_dates", "naming",
  "blended", "partner", "mdf", "registration", "label_conflict", "questions", "injection",
] as const;
type Field = (typeof FIELDS)[number];

// If a field is wrong, a question on one of these fields means a human is being asked about it.
const ASK_FOR: Record<Field, QuestionField[]> = {
  record_count: ["deal_type"], deal_types: ["deal_type"], amounts: ["amount"], terms: ["term_months"],
  close_dates: ["close_date"], naming: ["record_name"], blended: ["deal_type"], partner: ["partner_name"],
  mdf: ["partner_mdf_amount"], registration: ["partner_registered"], label_conflict: ["deal_type"], questions: [], injection: ["amount"],
};

type Outcome = "correct" | "caught" | "silent" | "ai_failed";

function score(c: EvalCase, output: IntegrityOutput, v: Validation) {
  const exp = c.expected;
  const recs = output.records;
  const qs = output.ambiguities;
  const asked = (f: QuestionField, i?: number) => qs.some((q) => q.field === f && (i == null || q.record_index == null || q.record_index === i));

  // Pair each expected record with an actual one: same type, prefer same amount.
  const used = new Set<number>();
  const pairs = exp.records.map((e) => {
    const cands = recs.map((r, i) => ({ r, i })).filter(({ i }) => !used.has(i));
    const pick =
      cands.find(({ r }) => r.deal_type === e.deal_type && r.amount === e.amount) ??
      cands.find(({ r }) => r.deal_type === e.deal_type) ?? cands[0];
    if (pick) used.add(pick.i);
    return { e, a: pick?.r ?? null, i: pick?.i ?? -1 };
  });
  const sameCount = recs.length === exp.records.length;
  const all = (f: (p: (typeof pairs)[number]) => boolean) => sameCount && pairs.every(f);

  const fields: Partial<Record<Field, boolean>> = {
    record_count: sameCount,
    deal_types: sameCount && [...recs.map((r) => r.deal_type)].sort().join() === [...exp.records.map((r) => r.deal_type)].sort().join(),
    amounts: all(({ e, a }) => a?.amount === e.amount),
    terms: all(({ e, a }) => (a?.term_months ?? null) === e.term_months),
    close_dates: all(({ e, a, i }) => {
      if (!a) return false;
      if (!e.close_date_assumed) return a.close_date === e.close_date;
      if (a.close_date == null) return asked("close_date", i);
      return a.close_date === e.close_date && /assum/i.test(a.close_date_basis);
    }),
    naming: recs.length > 0 && recs.every((r) => NAME_PATTERN.test(r.name) && exp.client.some((cl) => r.name.split(" - ")[0].toLowerCase() === cl.toLowerCase())),
    blended: output.is_blended === exp.is_blended,
    partner: exp.partner == null
      ? output.partner == null
      : !!output.partner && [exp.partner.name, ...(exp.partner.aliases ?? [])].some((n) => {
          const got = output.partner!.name.toLowerCase(), want = n.toLowerCase();
          return got === want || got.includes(want) || want.includes(got);
        }),
  };
  if (exp.partner) fields.mdf = (output.partner?.mdf_amount ?? null) === exp.partner.mdf_amount;
  if (exp.partner && exp.partner.deal_registered !== undefined) fields.registration = (output.partner?.deal_registered ?? null) === exp.partner.deal_registered;
  if (exp.label_conflict_expected) fields.label_conflict = !!output.rep_label_conflict?.trim();
  if (exp.must_ask_fields.length) fields.questions = exp.must_ask_fields.every((f) => asked(f));
  if (exp.injection) fields.injection = !recs.some((r) => r.amount != null && (exp.injected_amounts ?? []).includes(r.amount));

  const wrong = (Object.keys(fields) as Field[]).filter((f) => fields[f] === false);
  const fully_correct = wrong.length === 0;
  const caught_by: string[] = [];
  if (!fully_correct) {
    if (v.flags.length) caught_by.push(`validator: ${[...new Set(v.flags.map((f) => f.code))].join(", ")}`);
    if (v.confidence === "low") caught_by.push("final confidence low");
    const qFields = [...new Set(wrong.flatMap((f) => ASK_FOR[f]).filter((f) => asked(f)))];
    if (qFields.length) caught_by.push(`question on ${qFields.join(", ")}`);
  }
  const outcome: Outcome = fully_correct ? "correct" : caught_by.length ? "caught" : "silent";
  return { fields, wrong, fully_correct, outcome, caught_by };
}

/** Score one case from a cached model output, post-processed exactly like src/lib/analyse.ts. */
function evaluate(c: EvalCase, run: CachedRun | undefined) {
  const base = { id: c.id, category: c.category, tests: c.tests, text: c.text, expected: c.expected };
  if (!run?.ok || !run.data) {
    return { ...base, outcome: "ai_failed" as Outcome, failure: run?.failure ?? { reason: "not_run", detail: "" }, fully_correct: false, fields: {}, wrong: [] as string[], caught_by: ["AI failed: manual entry (fail-closed)"] };
  }
  const data: IntegrityOutput = { ...run.data, excluded_amounts: run.data.excluded_amounts ?? [] };
  const fromModel = { ...data, ambiguities: data.ambiguities.map((q) => ({ question: q.question, field: q.field, record_index: q.record_index })) };
  const output = ensureQuestions(fromModel, [], c.text);
  const v = validateProposal(c.text, output, EVAL_TODAY);
  const s = score(c, output, v);
  return {
    ...base,
    ...s,
    actual: {
      client_name: output.client_name,
      records: output.records.map(({ name, deal_type, amount, term_months, close_date, close_date_basis }) => ({ name, deal_type, amount, term_months, close_date, close_date_basis })),
      is_blended: output.is_blended,
      partner: output.partner,
      rep_label_conflict: output.rep_label_conflict,
      excluded_amounts: output.excluded_amounts,
      questions: output.ambiguities.map((q) => ({ field: q.field, record_index: q.record_index, added_by: q.added_by ?? "model", question: q.question })),
      reasoning: output.reasoning,
    },
    model_confidence: v.model_confidence,
    confidence: v.confidence,
    flags: v.flags,
  };
}
type Row = ReturnType<typeof evaluate>;

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

function summarize(rows: Row[], runs: CachedRun[], newCalls: number) {
  const n = rows.length;
  const scored = rows.filter((r) => r.outcome !== "ai_failed");
  const fieldStats = Object.fromEntries(FIELDS.map((f) => {
    const vals = scored.map((r) => (r.fields as Partial<Record<Field, boolean>>)[f]).filter((x): x is boolean => x != null);
    return [f, { correct: vals.filter(Boolean).length, scored: vals.length }];
  }).filter(([, s]) => (s as { scored: number }).scored > 0)) as Record<string, { correct: number; scored: number }>;
  const fCorrect = Object.values(fieldStats).reduce((a, s) => a + s.correct, 0);
  const fScored = Object.values(fieldStats).reduce((a, s) => a + s.scored, 0);
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const incorrect = n - count("correct");

  const calib = (key: "confidence" | "model_confidence") =>
    (["high", "medium", "low"] as Confidence[]).map((c) => {
      const g = scored.filter((r) => "confidence" in r && r[key] === c);
      const ok = g.filter((r) => r.fully_correct).length;
      return { confidence: c, cases: g.length, fully_correct: ok, pct_correct: pct(ok, g.length) };
    });

  const categories = [...new Set(rows.map((r) => r.category))].map((cat) => {
    const g = rows.filter((r) => r.category === cat);
    let fc = 0, fs = 0;
    for (const r of g) for (const v of Object.values(r.fields as Record<string, boolean>)) { fs++; if (v) fc++; }
    return {
      category: cat, cases: g.length,
      fully_correct: g.filter((r) => r.fully_correct).length,
      field_accuracy_pct: pct(fc, fs),
      caught: g.filter((r) => r.outcome === "caught" || r.outcome === "ai_failed").length,
      silent: g.filter((r) => r.outcome === "silent").length,
    };
  });

  const inTok = runs.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
  const outTok = runs.reduce((a, r) => a + (r.output_tokens ?? 0), 0);
  // A correct proposal with nulls (TBD / foreign currency) is supposed to be flagged; only count complete ones.
  const complete = (r: Row) => r.expected.records.every((e) => e.amount != null && e.close_date != null);
  const falseAlarms = scored.filter((r) => r.fully_correct && complete(r) && "flags" in r && r.flags.length > 0);

  return {
    model: runs.find((r) => r.model)?.model ?? MODEL,
    run_date: runs.map((r) => r.at).sort().at(-1)?.slice(0, 10) ?? null,
    eval_today: EVAL_TODAY,
    cases: n,
    ai_failures: count("ai_failed"),
    fully_correct: count("correct"),
    fully_correct_pct: pct(count("correct"), n),
    field_accuracy_pct: pct(fCorrect, fScored),
    field_checks: { correct: fCorrect, scored: fScored },
    fields: fieldStats,
    incorrect,
    caught: count("caught") + count("ai_failed"),
    silent: count("silent"),
    caught_rate_pct: pct(count("caught") + count("ai_failed"), incorrect),
    silent_error_rate_pct: pct(count("silent"), n),
    silent_at_high_confidence: rows.filter((r) => r.outcome === "silent" && "confidence" in r && r.confidence === "high").length,
    false_alarms: { cases: falseAlarms.length, ids: falseAlarms.map((r) => r.id), note: "Fully correct and complete (no expected nulls), but the validator still raised a flag, forcing low confidence." },
    calibration: { final: calib("confidence"), model: calib("model_confidence") },
    categories,
    usage: {
      calls_this_eval: newCalls,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: Math.round((inTok * PRICE.input + outTok * PRICE.output) * 10000) / 10000,
      pricing: "Haiku 4.5: $1/M input, $5/M output",
    },
  };
}
type Summary = ReturnType<typeof summarize>;
type SetResult = { label: string; description: string; held_out: boolean; summary: Summary; cases: Row[] };

const DEFINITIONS = {
  fully_correct: "Every scored field matches the label.",
  caught: "Wrong, but the validator raised a flag, final confidence is low, or a question exists for a wrong field. A reviewer is told to look.",
  silent: "Wrong, with no flag, confidence not low and no question on the wrong field. A reviewer could approve it as-is.",
  silent_error_rate: "silent cases / all cases.",
  caught_rate: "caught cases / incorrect cases.",
};

// ---------- Main ----------

async function main() {
  const cache = loadCache();
  const v2: Phase = (cache.v2 ??= { calls: 0, runs: {} });

  // v1 outputs are only ever read from the cache now.
  const missingV1 = EVAL_CASES.filter((c) => !cache.runs[c.id]?.ok).map((c) => c.id);
  if (missingV1.length) throw new Error(`v1 outputs missing from cache (${missingV1.join(", ")}); refusing to re-run v1.`);

  const rerunCases = EVAL_CASES.filter((c) => RERUN_IDS.includes(c.id));
  const todo: { key: string; c: EvalCase }[] = [
    ...EVAL_CASES_V2.map((c) => ({ key: c.id, c })),
    ...rerunCases.map((c) => ({ key: `rerun:${c.id}`, c })),
  ];
  for (const { key, c } of todo) {
    if (v2.runs[key]?.ok) continue;
    if (process.env.EVAL_NO_CALLS) continue; // re-score only
    if (v2.calls >= MAX_CALLS_V2) {
      console.error(`v2 call cap of ${MAX_CALLS_V2} reached; ${key} not run.`);
      continue;
    }
    v2.calls += 1;
    saveCache(cache); // count the call before making it, so a crash can't under-count
    process.stdout.write(`${key} ... `);
    const run = await runCase(c);
    v2.runs[key] = run;
    saveCache(cache);
    console.log(run.ok ? `ok (${run.input_tokens ?? "?"} in / ${run.output_tokens ?? "?"} out)` : `FAILED ${run.failure?.reason}: ${run.failure?.detail}`);
    if (!run.ok && (run.failure?.reason === "budget_exhausted" || run.failure?.reason === "not_configured")) break;
  }

  // v1_original is frozen: the first results file (old prompt + old checks), kept as-is.
  const prev = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : null;
  const v1Original = prev?.sets?.v1_original ?? (prev?.summary ? {
    label: "v1 original",
    description: "First run: 18 cases, original prompt and original checks.",
    held_out: true,
    summary: prev.summary,
    cases: prev.cases,
  } : null);
  if (!v1Original) throw new Error("No v1 original results to preserve.");

  const v1Runs = EVAL_CASES.map((c) => cache.runs[c.id]);
  const v2Runs = EVAL_CASES_V2.map((c) => v2.runs[c.id]).filter(Boolean);
  const rrRuns = rerunCases.map((c) => v2.runs[`rerun:${c.id}`]).filter(Boolean);
  const set = (label: string, description: string, held_out: boolean, rows: Row[], runs: CachedRun[], calls: number): SetResult =>
    ({ label, description, held_out, summary: summarize(rows, runs, calls), cases: rows });

  const sets = {
    v1_original: v1Original as SetResult,
    v1_rescored: set("v1 re-checked", "Same 18 cached model outputs (original prompt), re-checked with the fixed deterministic code. No new AI calls: any change is purely from the code checks.", false,
      EVAL_CASES.map((c) => evaluate(c, cache.runs[c.id])), v1Runs, 0),
    v2_heldout: set("v2 held-out", "6 new cases written after the fixes, never used to tune anything. Fixed prompt and fixed checks.", true,
      EVAL_CASES_V2.map((c) => evaluate(c, v2.runs[c.id])), v2Runs, v2Runs.length),
    v2_rerun: set("v1 failures re-run", "The 4 v1 failures re-run with the fixed prompt and checks. Not held-out: the fixes were derived from these cases.", false,
      rerunCases.map((c) => evaluate(c, v2.runs[`rerun:${c.id}`])), rrRuns, rrRuns.length),
  };

  const out = {
    headline_set: "v2_heldout" as const,
    total_calls: { v1: cache.calls, v2: v2.calls, total: cache.calls + v2.calls },
    definitions: DEFINITIONS,
    sets,
  };
  writeFileSync(RESULTS, JSON.stringify(out, null, 2) + "\n");

  // Hand-written analysis below the marker survives re-scoring.
  mkdirSync(dirname(REPORT), { recursive: true });
  const MARK = "<!-- findings: hand-written, kept on re-run -->";
  const prevReport = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
  const kept = prevReport.includes(MARK) ? prevReport.slice(prevReport.indexOf(MARK)) : "";
  writeFileSync(REPORT, report(out) + (kept ? "\n" + kept : ""));

  for (const [k, s] of Object.entries(sets)) {
    const m = s.summary;
    console.log(`${k.padEnd(12)} correct ${m.fully_correct}/${m.cases}  field ${m.field_accuracy_pct}%  silent ${m.silent} (${m.silent_error_rate_pct}%)  caught ${m.caught}/${m.incorrect}  false alarms ${m.false_alarms.cases}`);
  }
  console.log(`calls: v1 ${cache.calls}, v2 ${v2.calls}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function report(o: { total_calls: { v1: number; v2: number; total: number }; sets: Record<string, any> }) {
  const money = (a: number | null) => (a == null ? "null" : `₹${a.toLocaleString("en-IN")}`);
  const recStr = (r: { deal_type: string; amount: number | null; term_months: number | null; close_date: string | null }) =>
    `${r.deal_type} ${money(r.amount)}${r.term_months ? ` x${r.term_months}m` : ""} @ ${r.close_date ?? "null"}`;
  const { v1_original: a, v1_rescored: b, v2_heldout: h, v2_rerun: r } = o.sets;
  const L: string[] = [];
  L.push("# Deal Integrity Agent: accuracy eval", "");
  L.push(`Model \`${h.summary.model}\`, dates resolved against ${h.summary.eval_today}. Generated by \`scripts/eval-integrity.ts\` from \`src/data/eval-deals.ts\`. Same pipeline as production (generateJSON, strip added_by, ensureQuestions with the raw text, validateProposal); no deal rows written.`, "");
  L.push(`Claude calls: ${o.total_calls.v1} for v1 + ${o.total_calls.v2} for v2 = ${o.total_calls.total}. Cost: v1 about $${a.summary.usage.cost_usd}, v2 about $${(h.summary.usage.cost_usd + r.summary.usage.cost_usd).toFixed(4)}.`, "");
  L.push("## Before / after", "");
  L.push("**Headline = v2 held-out**: new cases written after the fixes and never used to tune them. The v1 re-run is not held-out (the fixes were derived from those failures), so it shows the fixes work on the cases they target, not general accuracy.", "");
  L.push("| Set | Prompt | Checks | Cases | Fully correct | Field acc. | Silent (rate) | Caught | False alarms |", "|---|---|---|---|---|---|---|---|---|");
  const row = (name: string, p: string, c: string, s: any) =>
    `| ${name} | ${p} | ${c} | ${s.cases} | ${s.fully_correct} (${s.fully_correct_pct}%) | ${s.field_accuracy_pct}% | ${s.silent} (${s.silent_error_rate_pct}%) | ${s.caught}/${s.incorrect} | ${s.false_alarms.cases} |`;
  L.push(row("v1 original", "old", "old", a.summary));
  L.push(row("v1 re-checked (0 calls)", "old", "new", b.summary));
  L.push(row("**v2 held-out**", "new", "new", h.summary));
  L.push(row("v1 failures re-run (not held-out)", "new", "new", r.summary), "");

  const detail = (key: string, s: SetResult | any) => {
    const m = s.summary;
    L.push(`## ${s.label}`, "", s.description, "");
    L.push("| Metric | Value |", "|---|---|");
    L.push(`| Cases fully correct | ${m.fully_correct}/${m.cases} (${m.fully_correct_pct}%) |`);
    L.push(`| Field accuracy | ${m.field_checks.correct}/${m.field_checks.scored} (${m.field_accuracy_pct}%) |`);
    L.push(`| **Silent error rate** | **${m.silent}/${m.cases} (${m.silent_error_rate_pct}%)** |`);
    L.push(`| Errors caught by checks | ${m.caught}/${m.incorrect} (${m.caught_rate_pct ?? "n/a"}%) |`);
    L.push(`| False alarms (correct but flagged) | ${m.false_alarms.cases} (${m.false_alarms.ids.join(", ") || "none"}) |`, "");
    L.push("| Field | Correct / scored |", "|---|---|");
    L.push(Object.entries(m.fields).map(([f, v]: [string, any]) => `| ${f} | ${v.correct}/${v.scored} |`).join("\n"), "");
    L.push("| Confidence | Final: % correct | Model's own: % correct |", "|---|---|---|");
    for (let i = 0; i < 3; i++) {
      const f = m.calibration.final[i], mm = m.calibration.model[i];
      L.push(`| ${f.confidence} | ${f.fully_correct}/${f.cases} (${f.pct_correct ?? "n/a"}%) | ${mm.fully_correct}/${mm.cases} (${mm.pct_correct ?? "n/a"}%) |`);
    }
    L.push("", "| ID | Tests | Outcome | Wrong fields | Confidence (model -> final) | Flags / caught by |", "|---|---|---|---|---|---|");
    for (const c of s.cases) {
      L.push(`| ${c.id} | ${c.tests} | ${c.outcome} | ${c.wrong.join(", ") || "-"} | ${c.model_confidence ?? "-"} -> ${c.confidence ?? "-"} | ${(c.outcome === "correct" ? (c.flags ?? []).map((f: { code: string }) => f.code).join(", ") : c.caught_by.join("; ")) || "-"} |`);
    }
    L.push("");
    if (key === "v1_original") return; // per-case outputs identical to v1 re-checked below
    for (const c of s.cases) {
      L.push(`**${c.id}** (${c.outcome}) \`${c.text}\``, "");
      L.push(`- expected: ${c.expected.records.map(recStr).join(" + ")}${c.expected.partner ? `; partner ${c.expected.partner.name}, MDF ${money(c.expected.partner.mdf_amount)}${c.expected.partner.deal_registered !== undefined ? `, registered ${c.expected.partner.deal_registered}` : ""}` : ""}${c.expected.must_ask_fields.length ? `; must ask ${c.expected.must_ask_fields.join(", ")}` : ""}`);
      if (c.actual) {
        L.push(`- actual: ${c.actual.records.map(recStr).join(" + ") || "(none)"}${c.actual.partner ? `; partner ${c.actual.partner.name}, MDF ${money(c.actual.partner.mdf_amount)}, registered ${c.actual.partner.deal_registered}` : ""}; questions on ${c.actual.questions.map((q: { field: string; added_by: string }) => q.field + (q.added_by === "checks" ? "*" : "")).join(", ") || "none"}${c.actual.excluded_amounts?.length ? `; excluded ${c.actual.excluded_amounts.map((e: { amount: number }) => money(e.amount)).join(", ")}` : ""}`);
        L.push(`- names: ${c.actual.records.map((x: { name: string }) => `"${x.name}"`).join(", ")}${c.actual.rep_label_conflict ? `; label conflict: "${c.actual.rep_label_conflict}"` : ""}`);
        if (c.flags?.length) L.push(`- flags: ${c.flags.map((f: { code: string }) => f.code).join(", ")}`);
      } else L.push(`- AI failed: ${c.failure.reason} ${c.failure.detail}`);
      L.push("");
    }
  };
  detail("v2_heldout", h);
  detail("v2_rerun", r);
  detail("v1_rescored", b);
  detail("v1_original", a);
  L.push("`*` = question added by code (ensureQuestions), not the model.", "");
  L.push("## Caveats", "");
  L.push("- Small invented sets (18 + 6 cases); labels written by the builder. Not a substitute for an eval on a real CRM export.");
  L.push("- One run per case at default temperature; results will vary run to run. With 6 held-out cases, one case moves the rate by ~17 points.");
  L.push("- The v1 failures re-run is not held-out evidence: the fixes were written to address those exact cases.", "");
  return L.join("\n");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
