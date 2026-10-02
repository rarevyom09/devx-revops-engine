"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  formatINR,
  planInvoices,
  templateMilestones,
  validateMilestones,
  type DealLite,
  type Milestone,
} from "@/lib/onboarding-validate";

type ListKey = "deliverables" | "success_criteria" | "risks_and_assumptions" | "open_questions";
const LISTS: { key: ListKey; label: string }[] = [
  { key: "deliverables", label: "Deliverables" },
  { key: "success_criteria", label: "Success criteria" },
  { key: "risks_and_assumptions", label: "Risks & assumptions" },
];

type BriefJson = {
  scope_summary?: string;
  deliverables?: string[];
  success_criteria?: string[];
  risks_and_assumptions?: string[];
  open_questions?: string[];
  validator_flags?: string[];
  source?: "ai" | "manual";
  model?: string | null;
  ai_error?: AIError | null;
};
type BriefRow = {
  id: string;
  status: "draft" | "approved";
  brief: BriefJson;
  milestones: Milestone[];
  approved_by: string | null;
  approved_at: string | null;
};
type Invoice = { id: string; milestone: string; amount: number; raised_on: string; variable_pay_at_stake: number };
type Deal = DealLite & {
  id: string;
  name: string;
  partner: string | null;
  owner: { name: string } | null;
  total: number;
  brief_status: "none" | "draft" | "approved";
  brief: BriefRow | null;
  invoices: Invoice[];
};
type AIError = { reason: string; detail: string };

type Editor = {
  brief_id: string | null;
  scope_summary: string;
  lists: Record<ListKey, string>; // one item per line
  milestones: Milestone[];
  source: "ai" | "manual";
  model: string | null;
  ai_error: AIError | null;
  isTemplate: boolean;
};

async function postJSON<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const toLines = (a?: string[]) => (a ?? []).join("\n");
const fromLines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function editorFromBrief(b: BriefRow): Editor {
  return {
    brief_id: b.id,
    scope_summary: b.brief.scope_summary ?? "",
    lists: {
      deliverables: toLines(b.brief.deliverables),
      success_criteria: toLines(b.brief.success_criteria),
      risks_and_assumptions: toLines(b.brief.risks_and_assumptions),
      open_questions: toLines(b.brief.open_questions),
    },
    milestones: b.milestones ?? [],
    source: b.brief.source ?? "manual",
    model: b.brief.model ?? null,
    ai_error: b.brief.ai_error ?? null,
    isTemplate: false,
  };
}

function manualEditor(deal: Deal, today: string, ai_error: AIError | null, existingId: string | null): Editor {
  return {
    brief_id: existingId,
    scope_summary: "",
    lists: { deliverables: "", success_criteria: "", risks_and_assumptions: "", open_questions: "" },
    milestones: templateMilestones(deal, today),
    source: "manual",
    model: null,
    ai_error,
    isTemplate: true,
  };
}

const typeLabel = (d: Deal) =>
  d.deal_type === "one_time" ? "One-time" : `Recurring ${formatINR(d.amount)}/mo × ${d.term_months}`;

export default function OnboardingPage() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [today, setToday] = useState("2026-10-02");
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState("");
  const [result, setResult] = useState<{ created: Invoice[]; skipped: string | null } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setConfigError(json.error ?? "Could not load deals");
      setDeals(null);
      return null;
    }
    setConfigError(null);
    setDeals(json.deals);
    setToday(json.today);
    return json.deals as Deal[];
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    refresh();
  }, [refresh]);

  const deal = deals?.find((d) => d.id === selectedId) ?? null;

  function select(d: Deal) {
    setSelectedId(d.id);
    setEditor(d.brief && d.brief.status === "draft" ? editorFromBrief(d.brief) : null);
    setError(null);
    setResult(null);
  }

  async function draftWithAI() {
    if (!deal) return;
    setBusy("draft");
    setError(null);
    const out = await postJSON<{ brief?: BriefRow; ai_error?: AIError; template?: unknown }>(
      "/api/onboarding/draft",
      { deal_id: deal.id },
    );
    setBusy(null);
    if (out.error) return setError(out.error);
    if (out.ai_error) {
      setEditor(manualEditor(deal, today, out.ai_error, deal.brief?.status === "draft" ? deal.brief.id : null));
      return;
    }
    if (out.brief) {
      setEditor(editorFromBrief(out.brief));
      refresh();
    }
  }

  async function save(): Promise<string | null> {
    if (!deal || !editor) return null;
    const out = await postJSON<{ brief?: BriefRow }>("/api/onboarding/save", {
      deal_id: deal.id,
      brief: {
        scope_summary: editor.scope_summary,
        deliverables: fromLines(editor.lists.deliverables),
        success_criteria: fromLines(editor.lists.success_criteria),
        risks_and_assumptions: fromLines(editor.lists.risks_and_assumptions),
        open_questions: fromLines(editor.lists.open_questions),
      },
      milestones: editor.milestones,
      source: editor.source,
      model: editor.model,
      ai_error: editor.ai_error,
    });
    if (out.error || !out.brief) {
      setError(out.error ?? "Save failed");
      return null;
    }
    setEditor((e) => (e ? { ...e, brief_id: out.brief!.id, isTemplate: false } : e));
    return out.brief.id;
  }

  async function saveDraft() {
    setBusy("save");
    setError(null);
    await save();
    setBusy(null);
    refresh();
  }

  async function approve() {
    if (!editor) return;
    setBusy("approve");
    setError(null);
    const id = await save();
    if (!id) return setBusy(null);
    const out = await postJSON<{
      invoices_created?: Invoice[];
      invoices_skipped_reason?: string | null;
      validator_flags?: string[];
    }>("/api/onboarding/approve", { brief_id: id, approved_by: approvedBy, milestones: editor.milestones });
    setBusy(null);
    if (out.error) {
      setError(out.validator_flags ? `${out.error} ${out.validator_flags.join(" ")}` : out.error);
      refresh();
      return;
    }
    setResult({ created: out.invoices_created ?? [], skipped: out.invoices_skipped_reason ?? null });
    setEditor(null);
    refresh();
  }

  return (
    <>
      <PageHeader title="Onboarding" engine="ai">
        Approved deal in → AI drafts the delivery brief, success criteria and billing milestones → code
        validates the money schedule → a human approves. Only approved briefs create invoices.
      </PageHeader>

      {configError && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Database not reachable.</b> {configError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-lg border border-zinc-200 bg-white">
          <h2 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold">Approved deals</h2>
          {deals && deals.length === 0 && (
            <p className="p-4 text-sm text-zinc-500">No approved deals yet. Approve one in Deal Integrity.</p>
          )}
          <ul>
            {deals?.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => select(d)}
                  className={`w-full border-t border-zinc-100 px-4 py-3 text-left first:border-0 hover:bg-zinc-50 ${
                    d.id === selectedId ? "bg-zinc-100" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{d.name}</span>
                    <StatusPill status={d.brief_status} />
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {typeLabel(d)} · total {formatINR(d.total)}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {d.deal_type === "one_time" ? "Project end" : "First billing"} {d.close_date}
                    {d.invoices.length > 0 && ` · ${d.invoices.length} invoice(s)`}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0">
          {!deal && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
              Select an approved deal.
            </div>
          )}
          {deal && (
            <DealPanel
              deal={deal}
              today={today}
              editor={editor}
              setEditor={setEditor}
              busy={busy}
              error={error}
              approvedBy={approvedBy}
              setApprovedBy={setApprovedBy}
              result={result}
              onDraft={draftWithAI}
              onManual={() =>
                setEditor(manualEditor(deal, today, null, deal.brief?.status === "draft" ? deal.brief.id : null))
              }
              onSave={saveDraft}
              onApprove={approve}
            />
          )}
        </section>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: Deal["brief_status"] }) {
  const cls =
    status === "approved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "draft"
        ? "bg-amber-100 text-amber-800"
        : "bg-zinc-100 text-zinc-600";
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{status === "none" ? "no brief" : status}</span>;
}

function DealPanel(props: {
  deal: Deal;
  today: string;
  editor: Editor | null;
  setEditor: (f: (e: Editor | null) => Editor | null) => void;
  busy: string | null;
  error: string | null;
  approvedBy: string;
  setApprovedBy: (s: string) => void;
  result: { created: Invoice[]; skipped: string | null } | null;
  onDraft: () => void;
  onManual: () => void;
  onSave: () => void;
  onApprove: () => void;
}) {
  const { deal, today, editor, setEditor, busy, error } = props;
  const approved = deal.brief?.status === "approved" ? deal.brief : null;
  const flags = useMemo(
    () => (editor ? validateMilestones(deal, editor.milestones, today) : []),
    [deal, editor, today],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{deal.name}</h2>
            <p className="text-sm text-zinc-600">
              {typeLabel(deal)} · total {formatINR(deal.total)} ·{" "}
              {deal.deal_type === "one_time" ? "project end" : "first billing"} {deal.close_date}
              {deal.owner && ` · owner ${deal.owner.name}`}
              {deal.partner && ` · partner ${deal.partner}`}
            </p>
          </div>
          {!approved && (
            <div className="flex gap-2">
              <button
                disabled={!!busy}
                onClick={props.onDraft}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {busy === "draft" ? "Drafting…" : editor ? "Re-draft with AI" : "Draft with AI"}
              </button>
              {!editor && (
                <button
                  disabled={!!busy}
                  onClick={props.onManual}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
                >
                  Write manually
                </button>
              )}
            </div>
          )}
        </div>
        {!approved && deal.invoices.length > 0 && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            This deal already has {deal.invoices.length} invoice(s). A brief can still be drafted and approved, but
            approval will <b>not</b> create new invoices (avoids double billing); reconcile existing invoices manually.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {approved && <ApprovedView deal={deal} brief={approved} result={props.result} />}

      {!approved && editor && (
        <>
          {editor.ai_error ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <b>AI unavailable — manual entry.</b> Reason: <code>{editor.ai_error.reason}</code> (
              {editor.ai_error.detail}). Fill in the brief yourself; it goes through the same validator and approval.
              {editor.isTemplate && (
                <span className="block pt-1">
                  Milestones below are a <b>template</b> (
                  {deal.deal_type === "one_time" ? "40/40/20 kickoff/UAT/go-live" : "generated monthly schedule"}),
                  not AI output.
                </span>
              )}
            </div>
          ) : editor.source === "ai" ? (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              <b>AI draft — needs human approval.</b> Produced by <code>{editor.model}</code>. Edit anything below
              before approving.
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <b>Manual brief.</b>{" "}
              {editor.isTemplate && "Milestones are pre-filled from a template, not AI output. "}Same validator and
              approval as AI drafts.
            </div>
          )}

          <BriefEditor editor={editor} setEditor={setEditor} />
          <MilestoneTable deal={deal} editor={editor} setEditor={setEditor} flags={flags} />

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4">
            <label className="block">
              <span className="text-sm font-medium">Approved by</span>
              <input
                value={props.approvedBy}
                onChange={(e) => props.setApprovedBy(e.target.value)}
                placeholder="Your name"
                className="mt-1 block w-56 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              disabled={!!busy}
              onClick={props.onSave}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              disabled={!!busy || flags.length > 0 || !props.approvedBy.trim()}
              onClick={props.onApprove}
              className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {busy === "approve" ? "Approving…" : "Approve brief & schedule invoices"}
            </button>
            <p className="w-full text-xs text-zinc-500">
              {flags.length > 0
                ? `Approve is disabled until ${flags.length} validator flag(s) are resolved.`
                : !props.approvedBy.trim()
                  ? "Enter your name to approve."
                  : "Approval is final: the brief becomes read-only and each milestone becomes a scheduled invoice."}
            </p>
          </div>
        </>
      )}

      {!approved && !editor && props.result === null && (
        <p className="text-sm text-zinc-500">
          No brief yet. Draft one with AI, or write it manually if the AI is unavailable.
        </p>
      )}
    </div>
  );
}

function BriefEditor({ editor, setEditor }: { editor: Editor; setEditor: (f: (e: Editor | null) => Editor | null) => void }) {
  const setList = (k: ListKey, v: string) => setEditor((e) => (e ? { ...e, lists: { ...e.lists, [k]: v } } : e));
  const area = "mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-zinc-900 focus:outline-none";
  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
        <span className="text-sm font-semibold text-amber-900">Open questions to resolve</span>
        <span className="ml-2 text-xs text-amber-800">one per line · confirm these with the client/rep before kickoff</span>
        <textarea
          rows={3}
          value={editor.lists.open_questions}
          onChange={(e) => setList("open_questions", e.target.value)}
          className={`${area} border-amber-300 bg-white`}
        />
      </div>
      <label className="block">
        <span className="text-sm font-medium">Scope summary</span>
        <textarea
          rows={3}
          value={editor.scope_summary}
          onChange={(e) => setEditor((x) => (x ? { ...x, scope_summary: e.target.value } : x))}
          className={area}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        {LISTS.map(({ key, label }) => (
          <label key={key} className="block">
            <span className="text-sm font-medium">{label}</span>
            <span className="ml-1 text-xs text-zinc-400">one per line</span>
            <textarea rows={5} value={editor.lists[key]} onChange={(e) => setList(key, e.target.value)} className={area} />
          </label>
        ))}
      </div>
    </div>
  );
}

function MilestoneTable(props: {
  deal: Deal;
  editor: Editor;
  setEditor: (f: (e: Editor | null) => Editor | null) => void;
  flags: string[];
}) {
  const { deal, editor, setEditor, flags } = props;
  const recurring = deal.deal_type === "recurring";
  const amounts = planInvoices(deal, editor.milestones);
  const pctSum = editor.milestones.reduce((s, m) => s + (Number.isFinite(m.pct) ? m.pct : 0), 0);
  const update = (i: number, patch: Partial<Milestone>) =>
    setEditor((e) => (e ? { ...e, milestones: e.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : e));
  const remove = (i: number) =>
    setEditor((e) => (e ? { ...e, milestones: e.milestones.filter((_, j) => j !== i) } : e));
  const add = () =>
    setEditor((e) =>
      e ? { ...e, milestones: [...e.milestones, { name: "", pct: 0, due_date: deal.close_date }] } : e,
    );
  const input = "w-full rounded border border-zinc-300 px-1.5 py-1 text-sm";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Billing milestones</h3>
        <span className="text-xs text-zinc-500">
          {recurring
            ? "Monthly schedule generated by code from term and first billing date (AI drafts language, code owns the money schedule)."
            : "Edit freely; the validator re-runs on every change. INR amounts are computed by code, never by the AI."}
        </span>
      </div>

      {flags.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <li className="font-semibold">Validator flags ({flags.length}) — approval blocked:</li>
          {flags.map((f, i) => (
            <li key={i}>• {f}</li>
          ))}
        </ul>
      )}
      {flags.length === 0 && (
        <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          ✓ Deterministic checks pass: percentages sum to 100, dates valid, ordered and in bounds, names unique.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Milestone</th>
              <th className="w-24 py-1 pr-2 font-medium">%</th>
              <th className="w-40 py-1 pr-2 font-medium">Due date</th>
              <th className="py-1 pr-2 text-right font-medium">Amount (INR)</th>
              {!recurring && <th />}
            </tr>
          </thead>
          <tbody>
            {editor.milestones.map((m, i) => (
              <tr key={i} className="border-t border-zinc-100">
                <td className="py-1 pr-2 text-xs text-zinc-400">{i + 1}</td>
                <td className="py-1 pr-2">
                  <input className={input} value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  {recurring ? (
                    <span className="tabular-nums">{m.pct.toFixed(2)}</span>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      className={input}
                      value={Number.isFinite(m.pct) ? m.pct : ""}
                      onChange={(e) => update(i, { pct: e.target.value === "" ? NaN : Number(e.target.value) })}
                    />
                  )}
                </td>
                <td className="py-1 pr-2">
                  {recurring ? (
                    <span className="tabular-nums">{m.due_date}</span>
                  ) : (
                    <input
                      type="date"
                      className={input}
                      value={m.due_date}
                      onChange={(e) => update(i, { due_date: e.target.value })}
                    />
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatINR(amounts[i]?.amount ?? 0)}</td>
                {!recurring && (
                  <td className="py-1 text-right">
                    <button onClick={() => remove(i)} className="text-xs text-zinc-400 hover:text-red-700">
                      remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t border-zinc-200 text-xs font-medium">
              <td />
              <td className="py-1.5 pr-2">Total</td>
              <td className="py-1.5 pr-2 tabular-nums">{Math.round(pctSum * 100) / 100}%</td>
              <td />
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {formatINR(amounts.reduce((s, a) => s + a.amount, 0))} / {formatINR(deal.total)}
              </td>
              {!recurring && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      {!recurring && (
        <button onClick={add} className="mt-2 text-xs text-zinc-600 underline hover:text-zinc-900">
          + add milestone
        </button>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Rounding remainder goes on the last milestone so invoices sum exactly to the deal total. Variable pay at stake
        = 5% of each invoice (invented rule).
      </p>
    </div>
  );
}

function ApprovedView({
  deal,
  brief,
  result,
}: {
  deal: Deal;
  brief: BriefRow;
  result: { created: Invoice[]; skipped: string | null } | null;
}) {
  const b = brief.brief;
  return (
    <>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <b>Approved</b> by {brief.approved_by} on {brief.approved_at?.slice(0, 10)} ·{" "}
        {b.source === "ai" ? `AI draft (${b.model}), human-approved` : "manual brief"}. Read-only.
      </div>
      {result?.skipped && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.skipped}</div>
      )}
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        {(b.open_questions?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="font-semibold text-amber-900">Open questions</div>
            <ul className="list-disc pl-5 text-amber-900">
              {b.open_questions!.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        {b.scope_summary && <p>{b.scope_summary}</p>}
        <div className="grid gap-4 md:grid-cols-3">
          {LISTS.map(({ key, label }) => (
            <div key={key}>
              <div className="font-medium">{label}</div>
              <ul className="list-disc pl-5 text-zinc-700">
                {(b[key] ?? []).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
                {(b[key] ?? []).length === 0 && <li className="list-none text-zinc-400">—</li>}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="text-sm font-semibold">Invoices for this deal</h3>
        <p className="mb-2 text-xs text-zinc-500">
          Scheduled invoices: <code>raised_on</code> is the milestone due date and may be in the future. Mock rows, not
          sent to Zoho.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-medium">Milestone</th>
                <th className="py-1 pr-2 font-medium">Raised on</th>
                <th className="py-1 pr-2 text-right font-medium">Amount</th>
                <th className="py-1 text-right font-medium">Variable pay at stake</th>
              </tr>
            </thead>
            <tbody>
              {deal.invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-zinc-100">
                  <td className="py-1 pr-2">{inv.milestone}</td>
                  <td className="py-1 pr-2 tabular-nums">{inv.raised_on}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatINR(Number(inv.amount))}</td>
                  <td className="py-1 text-right tabular-nums">{formatINR(Number(inv.variable_pay_at_stake))}</td>
                </tr>
              ))}
              {deal.invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-xs text-zinc-400">
                    No invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
