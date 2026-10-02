import "server-only";
import { analyseRawDeal } from "./analyse";
import { draftBrief } from "./brief-draft";
import { aiUsage } from "./claude";
import { db } from "./db";
import { normalizeQuestions } from "./integrity";
import { notify } from "./notify";
import { getSettings, type Settings } from "./settings";

// Event-driven AI: ingest -> analyse, approval -> brief. Runs after the response
// (next/server `after`), so people see results arrive as notifications.

async function budgetOk(s: Settings) {
  const u = await aiUsage();
  return u.used != null && u.limit - u.used > s.ai_reserve;
}

async function ownerOfRaw(id: string) {
  const { data } = await db().from("raw_deals").select("owner_id,raw_text").eq("id", id).single();
  return data as { owner_id: string | null; raw_text: string } | null;
}

const snippet = (t: string) => (t.length > 50 ? `${t.slice(0, 47)}…` : t);

const MAX_AUTO_PER_BATCH = 5;

export async function autoAnalyse(rawIds: string[]) {
  const s = await getSettings();
  if (!s.auto_analyse) return;
  if (rawIds.length > MAX_AUTO_PER_BATCH) {
    const waiting = rawIds.length - MAX_AUTO_PER_BATCH;
    await notify([{ kind: "ai_failed", severity: "info", title: `${waiting} more deal(s) waiting for analysis`, body: `Auto-analyse runs on up to ${MAX_AUTO_PER_BATCH} deals per upload to protect the AI budget. Analyse the rest from Deal Integrity.`, href: "/pipeline" }]);
  }
  for (const id of rawIds.slice(0, MAX_AUTO_PER_BATCH)) {
    const raw = await ownerOfRaw(id);
    if (!raw) continue;
    if (!(await budgetOk(s))) {
      await notify([{ kind: "ai_failed", severity: "warning", title: "Auto-analyse paused: AI reserve reached", body: `"${snippet(raw.raw_text)}" is waiting for a manual Analyse. ${s.ai_reserve} calls are kept in reserve.`, href: `/pipeline?raw=${id}`, owner_id: raw.owner_id, dedupe_key: `auto-paused:${id}` }]);
      continue;
    }
    try {
      const r = await analyseRawDeal(id);
      if (r.ok) {
        const o = r.analysis.output;
        const flags = r.analysis.validator_flags.flags.length;
        const qs = normalizeQuestions(o.ambiguities).length;
        await notify([{
          kind: "ai_analysed",
          severity: flags ? "warning" : "info",
          title: `${o.client_name ?? "Deal"} analysed: ${o.records.length} record${o.records.length === 1 ? "" : "s"}${o.is_blended ? ", blended deal split" : ""}`,
          body: `${r.analysis.confidence} confidence${flags ? ` · ${flags} failed check(s)` : ""}${qs ? ` · ${qs} question(s) for the rep` : ""}. Review and approve.`,
          href: `/pipeline?raw=${id}`,
          owner_id: raw.owner_id,
          dedupe_key: `analysed:${r.analysis.id}`,
        }]);
      } else if (!r.conflict) {
        await notify([{ kind: "ai_failed", severity: "warning", title: "Auto-analyse could not run", body: `${r.ai.reason}: ${r.ai.detail}. Nothing was guessed; analyse manually.`, href: `/pipeline?raw=${id}`, owner_id: raw.owner_id }]);
      }
    } catch (e) {
      await notify([{ kind: "ai_failed", severity: "warning", title: "Auto-analyse failed", body: e instanceof Error ? e.message : String(e), href: `/pipeline?raw=${id}`, owner_id: raw.owner_id }]);
    }
  }
}

export async function autoBrief(dealIds: string[]) {
  const s = await getSettings();
  if (!s.auto_brief) return;
  for (const id of dealIds) {
    const { data: deal } = await db().from("deals").select("id,name,owner_id").eq("id", id).single();
    if (!deal) continue;
    if (!(await budgetOk(s))) {
      await notify([{ kind: "ai_failed", severity: "warning", title: "Auto-brief paused: AI reserve reached", body: `Draft the brief for ${deal.name} manually.`, href: "/onboarding", owner_id: deal.owner_id, dedupe_key: `brief-paused:${id}` }]);
      continue;
    }
    try {
      const r = await draftBrief(id);
      if (r.status === "ok") {
        const ms = (r.brief as { milestones?: unknown[] }).milestones?.length ?? 0;
        await notify([{ kind: "brief_drafted", title: `Brief drafted: ${deal.name}`, body: `${ms} billing milestone(s) and success criteria ready. Approve to schedule invoices.`, href: "/onboarding", owner_id: deal.owner_id, dedupe_key: `brief:${id}` }]);
      } else if (r.status === "ai_error") {
        await notify([{ kind: "ai_failed", severity: "warning", title: `Auto-brief could not run: ${deal.name}`, body: `${r.ai_error.reason}: ${r.ai_error.detail}. A template is ready for manual entry.`, href: "/onboarding", owner_id: deal.owner_id }]);
      }
    } catch (e) {
      await notify([{ kind: "ai_failed", severity: "warning", title: `Auto-brief failed: ${deal.name}`, body: e instanceof Error ? e.message : String(e), href: "/onboarding", owner_id: deal.owner_id }]);
    }
  }
}
