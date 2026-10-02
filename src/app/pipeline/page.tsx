"use client";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  ApprovedRecord,
  PRACTICES,
  PracticeSplit,
  normalizeQuestions,
  type Confidence,
  type Flag,
  type IntegrityOutput,
  type QuestionField,
  type RepAnswer,
  type RepQuestion,
  type Validation,
} from "@/lib/integrity";

type Analysis = {
  id: string;
  model: string;
  output: IntegrityOutput;
  confidence: Confidence;
  validator_flags: Validation & { today: string; answers_used?: number };
  rep_answers?: RepAnswer[] | null;
  created_at: string;
};
type QueueItem = {
  id: string;
  source: string;
  raw_text: string;
  status: "pending" | "analysed" | "approved" | "rejected";
  owner: { name: string; entity: string } | null;
  latest_analysis: Analysis | null;
  analysis_count: number;
  deals: { id: string; name: string; deal_type: string; amount: number; term_months: number | null; close_date: string; partner: string | null; approved_by: string }[];
};
type EditRecord = {
  name: string;
  deal_type: "one_time" | "recurring";
  amount: string;
  term_months: string;
  close_date: string;
  close_date_basis?: string;
  scope?: string;
};
type Partner = IntegrityOutput["partner"];

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

async function postJSON<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

export default function PipelinePage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/pipeline", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setQueue(json.queue);
    const wanted = new URLSearchParams(window.location.search).get("raw");
    setSelected(
      (s) =>
        s ??
        (json.queue.some((q: QueueItem) => q.id === wanted) ? wanted : null) ??
        json.queue.find((q: QueueItem) => q.status !== "approved")?.id ??
        json.queue[0]?.id ??
        null,
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    refresh();
  }, [refresh]);

  const waiting = queue?.some((q) => q.status === "pending") ?? false;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [waiting, refresh]);

  const item = queue?.find((q) => q.id === selected) ?? null;

  return (
    <>
      <PageHeader title="Deal Integrity" engine="ai">
        Claude reads each raw deal and proposes clean records: one-time and recurring revenue split apart,
        close dates set by the rules, names standardised, partners flagged. Code re-checks every amount and
        date against the source text. Nothing becomes a deal until a human approves it.
      </PageHeader>

      {error && <Banner tone="amber">{error}</Banner>}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Queue ({queue?.filter((q) => q.status === "pending" || q.status === "analysed").length ?? 0} open)
          </div>
          {queue?.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
              No raw deals. Add some in Ingest or load demo data.
            </div>
          )}
          {queue?.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelected(q.id)}
              className={`block w-full rounded-lg border p-3 text-left text-sm transition ${
                q.id === selected ? "border-zinc-900 bg-white shadow-sm" : "border-zinc-200 bg-white hover:border-zinc-400"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <StatusBadge status={q.status} />
                {q.latest_analysis && q.status !== "approved" && <ConfidenceBadge c={q.latest_analysis.confidence} />}
                <span className="ml-auto text-xs text-zinc-400">{q.owner?.name ?? "unassigned"}</span>
              </div>
              <div className="line-clamp-2 text-zinc-700">{q.raw_text}</div>
            </button>
          ))}
        </aside>

        <section>{item ? <DealDetail key={item.id + item.status + item.analysis_count} item={item} onChange={refresh} /> : null}</section>
      </div>
    </>
  );
}

function DealDetail({ item, onChange }: { item: QueueItem; onChange: () => void }) {
  const a = item.latest_analysis;
  const [busy, setBusy] = useState<string | null>(null);
  const [aiDown, setAiDown] = useState<{ reason: string; detail: string } | null>(null);
  const [records, setRecords] = useState<EditRecord[]>(() => (a ? a.output.records.map(toEdit) : []));
  const [partner, setPartner] = useState<Partner>(a?.output.partner ?? null);
  const [approver, setApprover] = useState("");
  const [split, setSplit] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const questions = normalizeQuestions(a?.output.ambiguities);
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries((a?.rep_answers ?? []).map((x) => [x.index, x.answer])),
  );
  const [savedNote, setSavedNote] = useState<string | null>(null);

  function answerList(): RepAnswer[] {
    const now = new Date().toISOString();
    return questions.flatMap((q, index) => {
      const answer = answers[index]?.trim();
      return answer ? [{ index, question: q.question, field: q.field, record_index: q.record_index, answer, answered_at: now }] : [];
    });
  }

  // Answering a question writes straight into the field it is about.
  function answer(index: number, value: string) {
    setAnswers((s) => ({ ...s, [index]: value }));
    setSavedNote(null);
    const q = questions[index];
    const ri = q.record_index ?? (records.length === 1 ? 0 : null);
    const v = value.trim();
    if (!v) return;
    const setRecord = (patch: Partial<EditRecord>) =>
      ri != null && setRecords((rs) => rs.map((r, j) => (j === ri ? { ...r, ...patch } : r)));
    const setP = (patch: Partial<NonNullable<Partner>>) =>
      setPartner((p) => ({ ...(p ?? { name: "", type: "co-sell", mdf_amount: null, deal_registered: null }), ...patch }));
    switch (q.field) {
      case "close_date":
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setRecord({ close_date: v, close_date_basis: "confirmed by rep" });
        break;
      case "amount":
        setRecord({ amount: v.replace(/[₹,\s]/g, "") });
        break;
      case "term_months":
        setRecord({ term_months: v });
        break;
      case "deal_type":
        if (v === "one_time" || v === "recurring") setRecord({ deal_type: v, ...(v === "one_time" ? { term_months: "" } : {}) });
        break;
      case "record_name":
        setRecord({ name: v });
        break;
      case "partner_registered":
        if (v === "yes" || v === "no") setP({ deal_registered: v === "yes" });
        break;
      case "partner_mdf_amount":
        setP({ mdf_amount: Number(v.replace(/[₹,\s]/g, "")) || null });
        break;
      case "partner_name":
        setP({ name: v });
        break;
    }
  }

  async function saveAnswers() {
    if (!a) return;
    setBusy("answers");
    const out = await postJSON<{ ok?: boolean }>("/api/pipeline/answers", { analysis_id: a.id, answers: answerList() });
    setBusy(null);
    setSavedNote(out.error ? null : "Answers saved to the analysis audit trail.");
    if (out.error) setMsg(out.error);
  }

  async function analyse(withAnswers = false) {
    setBusy(withAnswers ? "reanalyse" : "analyse");
    setMsg(null);
    if (withAnswers && a) await postJSON("/api/pipeline/answers", { analysis_id: a.id, answers: answerList() });
    const out = await postJSON<{ analysis?: Analysis; ai_unavailable?: boolean; reason?: string; detail?: string }>(
      "/api/pipeline/analyse",
      { raw_deal_id: item.id, ...(withAnswers ? { answers: answerList() } : {}) },
    );
    setBusy(null);
    if (out.error) return setMsg(out.error);
    if (out.ai_unavailable) {
      setAiDown({ reason: out.reason!, detail: out.detail! });
      if (records.length === 0) setRecords([blankRecord()]);
      return;
    }
    onChange();
  }

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setMsg(null);
    const body =
      action === "reject"
        ? { action, raw_deal_id: item.id }
        : {
            action,
            raw_deal_id: item.id,
            analysis_id: a?.id ?? null,
            approved_by: approver,
            partner,
            practice_split: splitValue,
            answers: answerList(),
            records: records.map(fromEdit),
          };
    const out = await postJSON<{ ok?: boolean }>("/api/pipeline/decide", body);
    setBusy(null);
    if (out.error) return setMsg(out.error);
    onChange();
  }

  const recordErrors = records.map((r) => {
    const p = ApprovedRecord.safeParse(fromEdit(r));
    return p.success ? [] : p.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`);
  });
  const splitEntries = Object.entries(split).filter(([, v]) => v.trim() !== "");
  const splitValue = splitEntries.length
    ? Object.fromEntries(splitEntries.map(([k, v]) => [k, Number(v) / 100]))
    : null;
  const splitCheck = splitValue ? PracticeSplit.safeParse(splitValue) : null;
  const splitError = splitCheck && !splitCheck.success ? splitCheck.error.issues[0].message : null;
  const editable = item.status === "pending" || item.status === "analysed";
  const showEditor = editable && (a || aiDown);
  const unanswered = questions.filter((_, i) => !answers[i]?.trim()).length;
  const hasFlags = (a?.validator_flags.flags.length ?? 0) > 0;
  // Ack is needed while anything is unresolved: failed checks, or open questions on a non-high analysis.
  const needsAck = !a || hasFlags || (a.confidence !== "high" && unanswered > 0);
  const canApprove =
    records.length > 0 && recordErrors.every((e) => e.length === 0) && !splitError && approver.trim() && (!needsAck || ack);

  return (
    <div className="space-y-4">
      <Card title="Raw deal text" right={<span className="text-xs text-zinc-400">untrusted input, stored verbatim · {item.source}</span>}>
        <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-mono text-sm text-zinc-800">{item.raw_text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {editable && (
            <button onClick={() => analyse()} disabled={!!busy} className="rounded-md bg-violet-700 px-4 py-1.5 text-sm text-white hover:bg-violet-800 disabled:opacity-50">
              {busy === "analyse" ? "Claude is reading…" : a ? "Re-analyse" : "Analyse with AI"}
            </button>
          )}
          {editable && (
            <button onClick={() => decide("reject")} disabled={!!busy} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
              Reject
            </button>
          )}
          <span className="text-xs text-zinc-500">
            Owner: {item.owner ? `${item.owner.name} (${item.owner.entity})` : "unassigned"}
            {item.analysis_count > 0 && ` · ${item.analysis_count} analysis run(s) kept for audit`}
          </span>
        </div>
      </Card>

      {msg && <Banner tone="red">{msg}</Banner>}

      {aiDown && (
        <Banner tone="amber">
          <b>AI unavailable: manual entry.</b> {aiDown.detail}. Nothing was guessed; fill in the records below
          yourself. The same checks apply.
        </Banner>
      )}

      {item.status === "approved" && <ApprovedView item={item} />}
      {item.status === "rejected" && <Banner tone="zinc">Rejected. No deal records were created.</Banner>}

      {a && editable && <AnalysisView a={a} />}

      {a && editable && questions.length > 0 && (
        <Card
          title="Questions for the rep"
          right={
            <span className={`text-xs ${unanswered ? "text-amber-700" : "text-emerald-700"}`}>
              {questions.length - unanswered}/{questions.length} answered
            </span>
          }
        >
          <p className="mb-3 text-xs text-zinc-500">
            Each answer is written straight into the field it is about (shown on the right). Save keeps them on the
            audit trail; re-analysing sends them back to Claude (1 AI call).
          </p>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <QuestionRow
                key={i}
                q={q}
                target={fieldLabel(q, records)}
                value={answers[i] ?? ""}
                onChange={(v) => answer(i, v)}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={saveAnswers}
              disabled={!!busy || questions.length === unanswered}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {busy === "answers" ? "Saving…" : "Save answers"}
            </button>
            <button
              onClick={() => analyse(true)}
              disabled={!!busy || questions.length === unanswered}
              className="rounded-md border border-violet-300 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50 disabled:opacity-40"
            >
              {busy === "reanalyse" ? "Claude is re-reading…" : "Re-analyse with answers"}
            </button>
            {savedNote && <span className="text-xs text-emerald-700">{savedNote}</span>}
          </div>
        </Card>
      )}

      {showEditor && (
        <Card
          title="Proposed records"
          right={<span className="text-xs text-zinc-500">{a ? "AI proposal, editable" : "manual entry"}</span>}
        >
          <div className="space-y-3">
            {records.map((r, i) => (
              <RecordEditor
                key={i}
                r={r}
                errors={recordErrors[i]}
                onChange={(next) => setRecords((rs) => rs.map((x, j) => (j === i ? next : x)))}
                onRemove={records.length > 1 ? () => setRecords((rs) => rs.filter((_, j) => j !== i)) : undefined}
              />
            ))}
            <button onClick={() => setRecords((rs) => [...rs, blankRecord()])} className="text-sm text-zinc-600 hover:text-zinc-900">
              + Add record
            </button>
          </div>

          <PartnerEditor partner={partner} onChange={setPartner} />

          <div className="mt-4 rounded-md border border-dashed border-zinc-300 p-3">
            <div className="text-sm font-medium">Practice attribution (double bubble)</div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Consulting owner gets 100%. Practice teams share by pillar; must total 100%. Leave blank to
              approve without it (it will show as an attribution leak).
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {PRACTICES.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm">
                  {p}
                  <input
                    inputMode="numeric"
                    value={split[p] ?? ""}
                    onChange={(e) => setSplit((s) => ({ ...s, [p]: e.target.value }))}
                    className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    placeholder="%"
                  />
                </label>
              ))}
            </div>
            {splitError && <div className="mt-1 text-xs text-red-700">{splitError}</div>}
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
            <label className="block">
              <span className="text-xs font-medium text-zinc-600">Approved by</span>
              <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Ops lead name" className="mt-1 block w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
            </label>
            {needsAck && (
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {hasFlags ? "I reviewed the failed checks above" : `I accept ${unanswered || "the"} open question${unanswered === 1 ? "" : "s"} unanswered`}
              </label>
            )}
            <button
              onClick={() => decide("approve")}
              disabled={!canApprove || !!busy}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {busy === "approve" ? "Saving…" : `Approve ${records.length} record${records.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Approval writes all records in one step. This is the only path into the deals table.
          </p>
        </Card>
      )}
    </div>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  const v = a.validator_flags;
  const o = a.output;
  return (
    <Card
      title="AI analysis"
      right={
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <ConfidenceBadge c={a.confidence} />
          {v.model_confidence !== a.confidence && <span>model said {v.model_confidence}, capped by checks</span>}
          <span className="font-mono">{a.model}</span>
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        {o.is_blended && (
          <Banner tone="violet">
            <b>Blended deal detected.</b> One-time and recurring revenue were mixed in one description; split into{" "}
            {o.records.length} records.
          </Banner>
        )}
        {o.rep_label_conflict && (
          <Banner tone="amber">
            <b>Rep label conflict:</b> {o.rep_label_conflict}
          </Banner>
        )}
        <p className="text-zinc-700">{o.reasoning}</p>

        {v.flags.length > 0 && (
          <List title="Validator flags (deterministic checks failed)" tone="red" items={v.flags.map((f: Flag) => f.message)} />
        )}
        {v.flags.length === 0 && (
          <p className="text-xs text-emerald-700">✓ All deterministic checks passed (amounts, dates, types, naming, partner).</p>
        )}
      </div>
    </Card>
  );
}

function RecordEditor({ r, errors, onChange, onRemove }: { r: EditRecord; errors: string[]; onChange: (r: EditRecord) => void; onRemove?: () => void }) {
  const set = (k: keyof EditRecord, v: string) => onChange({ ...r, [k]: v });
  const recurring = r.deal_type === "recurring";
  const amt = Number(r.amount);
  const months = Number(r.term_months);
  const cls = "mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  return (
    <div className={`rounded-md border p-3 ${errors.length ? "border-red-200 bg-red-50/40" : "border-zinc-200"}`}>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_0.7fr_1fr]">
        <label className="block">
          <span className="text-xs font-medium text-zinc-600">Name</span>
          <input className={cls} value={r.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-600">Type</span>
          <select
            className={cls}
            value={r.deal_type}
            onChange={(e) => onChange({ ...r, deal_type: e.target.value as EditRecord["deal_type"], term_months: e.target.value === "one_time" ? "" : r.term_months })}
          >
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-600">{recurring ? "Monthly ₹" : "Total ₹"}</span>
          <input className={cls} inputMode="numeric" value={r.amount} onChange={(e) => set("amount", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-600">Months</span>
          <input className={cls} inputMode="numeric" disabled={!recurring} value={r.term_months} onChange={(e) => set("term_months", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-600">{recurring ? "First billing" : "Project end"}</span>
          <input type="date" className={cls} value={r.close_date} onChange={(e) => set("close_date", e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        {r.close_date_basis && <span>Date basis: {r.close_date_basis}</span>}
        {recurring && amt > 0 && months > 0 && <span>Contract value: {inr(amt * months)} ({inr(amt * 12)} annualised)</span>}
        {onRemove && (
          <button onClick={onRemove} className="ml-auto text-red-600 hover:text-red-800">
            Remove
          </button>
        )}
      </div>
      {errors.length > 0 && <div className="mt-1 text-xs text-red-700">{errors.join(" · ")}</div>}
    </div>
  );
}

function PartnerEditor({ partner, onChange }: { partner: Partner; onChange: (p: Partner) => void }) {
  const cls = "mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  return (
    <div className="mt-4 rounded-md border border-dashed border-zinc-300 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Partner <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">flag only, stubbed</span>
        </span>
        <label className="flex items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={!!partner}
            onChange={(e) => onChange(e.target.checked ? { name: "", type: "co-sell", mdf_amount: null, deal_registered: null } : null)}
          />
          Partner involved
        </label>
      </div>
      {partner && (
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs text-zinc-600">Name</span>
            <input className={cls} value={partner.name} onChange={(e) => onChange({ ...partner, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600">Motion</span>
            <select className={cls} value={partner.type} onChange={(e) => onChange({ ...partner, type: e.target.value as NonNullable<Partner>["type"] })}>
              {["co-sell", "resell", "referral", "mdf", "other"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600">MDF ₹</span>
            <input
              className={cls}
              value={partner.mdf_amount ?? ""}
              onChange={(e) => onChange({ ...partner, mdf_amount: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600">Deal registered</span>
            <select
              className={cls}
              value={partner.deal_registered == null ? "" : String(partner.deal_registered)}
              onChange={(e) => onChange({ ...partner, deal_registered: e.target.value === "" ? null : e.target.value === "true" })}
            >
              <option value="">unknown</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function ApprovedView({ item }: { item: QueueItem }) {
  return (
    <Card title="Approved deal records" right={<span className="text-xs text-zinc-500">by {item.deals[0]?.approved_by}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 pr-3 font-medium">Type</th>
              <th className="py-1 pr-3 font-medium">Amount</th>
              <th className="py-1 pr-3 font-medium">Close date</th>
              <th className="py-1 font-medium">Partner</th>
            </tr>
          </thead>
          <tbody>
            {item.deals.map((d) => (
              <tr key={d.id} className="border-t border-zinc-100">
                <td className="py-1.5 pr-3">{d.name}</td>
                <td className="py-1.5 pr-3">{d.deal_type === "one_time" ? "One-time" : "Recurring"}</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {d.deal_type === "recurring" ? `${inr(d.amount)}/mo × ${d.term_months}` : inr(d.amount)}
                </td>
                <td className="py-1.5 pr-3">{d.close_date}</td>
                <td className="py-1.5">{d.partner ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Next: draft the delivery brief and billing milestones in Onboarding.</p>
    </Card>
  );
}

const FIELD_LABEL: Record<QuestionField, string> = {
  close_date: "close date",
  amount: "amount",
  term_months: "term (months)",
  deal_type: "deal type",
  record_name: "record name",
  partner_registered: "partner · deal registered",
  partner_mdf_amount: "partner · MDF ₹",
  partner_name: "partner · name",
  other: "note only",
};

function fieldLabel(q: RepQuestion, records: EditRecord[]) {
  const r = q.record_index != null ? records[q.record_index] : records.length === 1 ? records[0] : null;
  const isRecordField = !q.field.startsWith("partner") && q.field !== "other";
  return isRecordField && r ? `${r.name || "record"} · ${FIELD_LABEL[q.field]}` : FIELD_LABEL[q.field];
}

function QuestionRow({ q, target, value, onChange }: { q: RepQuestion; target: string; value: string; onChange: (v: string) => void }) {
  const cls = "mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  let input: React.ReactNode;
  if (q.field === "close_date") input = <input type="date" className={cls} value={value} onChange={(e) => onChange(e.target.value)} />;
  else if (q.field === "partner_registered")
    input = (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— answer —</option>
        <option value="yes">Yes, registered</option>
        <option value="no">No, not registered</option>
      </select>
    );
  else if (q.field === "deal_type")
    input = (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— answer —</option>
        <option value="one_time">One-time</option>
        <option value="recurring">Recurring</option>
      </select>
    );
  else
    input = (
      <input
        className={cls}
        inputMode={q.field === "amount" || q.field === "partner_mdf_amount" || q.field === "term_months" ? "numeric" : undefined}
        placeholder={q.field === "other" ? "Answer (saved as a note)" : "Answer"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className={`grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_220px] ${value.trim() ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
      <div className="text-sm text-zinc-800">
        {q.question}
        {q.added_by === "checks" && (
          <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-medium uppercase text-sky-800" title="The AI assumed this without asking; code added the question.">
            added by checks
          </span>
        )}
      </div>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">→ {target}</span>
        {input}
      </label>
    </div>
  );
}

// ---------- helpers ----------

function toEdit(r: IntegrityOutput["records"][number]): EditRecord {
  return {
    name: r.name,
    deal_type: r.deal_type,
    amount: r.amount == null ? "" : String(r.amount),
    term_months: r.term_months == null ? "" : String(r.term_months),
    close_date: r.close_date ?? "",
    close_date_basis: r.close_date_basis,
    scope: r.scope,
  };
}
function fromEdit(r: EditRecord) {
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[₹,\s]/g, "")));
  return {
    name: r.name,
    deal_type: r.deal_type,
    amount: num(r.amount),
    term_months: r.deal_type === "recurring" && r.term_months.trim() ? num(r.term_months) : null,
    close_date: r.close_date,
  };
}
function blankRecord(): EditRecord {
  return { name: "", deal_type: "one_time", amount: "", term_months: "", close_date: "" };
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

const TONES = {
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-800",
  violet: "border-violet-200 bg-violet-50 text-violet-900",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700",
};
function Banner({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <div className={`rounded-lg border p-3 text-sm ${TONES[tone]}`}>{children}</div>;
}
function List({ title, tone, items }: { title: string; tone: keyof typeof TONES; items: string[] }) {
  return (
    <div className={`rounded-md border p-3 ${TONES[tone]}`}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide">{title}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function ConfidenceBadge({ c }: { c: Confidence }) {
  const s = { high: "bg-emerald-100 text-emerald-800", medium: "bg-amber-100 text-amber-800", low: "bg-red-100 text-red-800" }[c];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${s}`}>{c} confidence</span>;
}
function StatusBadge({ status }: { status: QueueItem["status"] }) {
  const s = {
    pending: "bg-zinc-100 text-zinc-700",
    analysed: "bg-violet-100 text-violet-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-zinc-200 text-zinc-500",
  }[status];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${s}`}>{status}</span>;
}
