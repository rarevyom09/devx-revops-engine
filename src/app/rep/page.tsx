"use client";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { QuestionField } from "@/lib/integrity";

type Rep = { id: string; name: string; entity: string };
type Rec = { name: string; deal_type: "one_time" | "recurring"; amount: number | null; term_months: number | null; close_date: string | null; close_date_basis: string };
type Question = { question: string; field: QuestionField; record_index: number | null; index: number; answer: string | null; answered_by: string | null; added_by?: string };
type RepDeal = {
  id: string;
  raw_text: string;
  status: "pending" | "analysed" | "approved";
  created_at: string;
  analysis: {
    id: string;
    confidence: "high" | "medium" | "low";
    records: Rec[];
    partner: { name: string; type: string; mdf_amount: number | null; deal_registered: boolean | null } | null;
    reasoning: string;
    rep_label_conflict: string | null;
    is_blended: boolean;
    answers_used: number;
  } | null;
  questions: Question[];
  deals: { name: string; deal_type: string; amount: number; term_months: number | null; close_date: string }[];
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const KEY = "revops.rep";

// Plain-language read-back of what the AI understood, for the rep to sanity-check.
function describe(r: Rec) {
  const assumed = /assum/i.test(r.close_date_basis);
  if (r.deal_type === "one_time") {
    return `One-time project "${r.name}"${r.amount != null ? ` for ${inr(r.amount)}` : " (amount unknown)"}${r.close_date ? `, ending ${date(r.close_date)}` : ", end date unknown"}${assumed ? " (assumed)" : ""}.`;
  }
  return `Monthly retainer "${r.name}"${r.amount != null ? ` at ${inr(r.amount)}/month` : " (monthly amount unknown)"}${r.term_months ? ` for ${r.term_months} months` : ", term unknown"}${r.close_date ? `, first bill ${date(r.close_date)}` : ""}${assumed ? " (assumed)" : ""}.`;
}

export default function RepInboxPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [rep, setRep] = useState("");
  const [deals, setDeals] = useState<RepDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (who: string) => {
    const res = await fetch(`/api/rep${who ? `?rep=${who}` : ""}`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) return setError(j.error);
    setError(null);
    setReps(j.reps);
    setDeals(who ? j.deals : null);
  }, []);

  useEffect(() => {
    let who = "";
    try {
      who = localStorage.getItem(KEY) ?? "";
    } catch {}
    const id = setTimeout(() => {
      setRep(who);
      load(who);
    });
    return () => clearTimeout(id);
  }, [load]);

  // Re-analysis after answering arrives in the background; refresh while anything is pending.
  useEffect(() => {
    if (!rep) return;
    const id = setInterval(() => load(rep), 10000);
    return () => clearInterval(id);
  }, [rep, load]);

  const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("raw") : null;
  const needs = deals?.filter((d) => d.status !== "approved" && d.questions.some((q) => !q.answer)) ?? [];
  const waiting = deals?.filter((d) => d.status !== "approved" && !d.questions.some((q) => !q.answer)) ?? [];
  const approved = deals?.filter((d) => d.status === "approved") ?? [];

  return (
    <>
      <PageHeader title="Rep inbox" engine="ai">
        For sales reps. The integrity agent reads every deal you submit, plays back what it understood, and asks you only
        what it couldn&apos;t work out. Your answers go straight into the deal and it re-checks itself; ops then approves.
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-600">
          I am{" "}
          <select
            value={rep}
            onChange={(e) => {
              setRep(e.target.value);
              setDeals(null);
              try {
                localStorage.setItem(KEY, e.target.value);
              } catch {}
              load(e.target.value);
            }}
            className="ml-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="">— choose your name —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.entity})
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-zinc-500">Demo: there are no logins, so pick who you are.</span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
      {!rep && <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">Choose your name to see your deals.</div>}

      {deals && (
        <div className="space-y-8">
          <Section title={`Needs your answers (${needs.length})`} empty="Nothing to answer. ✓">
            {needs
              .sort((a, b) => (a.id === wanted ? -1 : b.id === wanted ? 1 : 0))
              .map((d) => (
                <AnswerCard key={d.id + (d.analysis?.id ?? "")} d={d} rep={rep} onDone={() => load(rep)} highlight={d.id === wanted} />
              ))}
          </Section>
          <Section title={`Waiting for ops approval (${waiting.length})`} empty="Nothing waiting.">
            {waiting.map((d) => (
              <ReadBack key={d.id} d={d} note={d.status === "pending" ? "The integrity agent is reading this deal…" : "All questions answered. Ops will review and approve."} />
            ))}
          </Section>
          <Section title={`Approved (${approved.length})`} empty="No approved deals yet.">
            {approved.map((d) => (
              <div key={d.id} className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
                <p className="line-clamp-2 text-zinc-500">{d.raw_text}</p>
                <ul className="mt-2 space-y-0.5">
                  {d.deals.map((x) => (
                    <li key={x.name}>
                      ✓ <b>{x.name}</b> · {x.deal_type === "recurring" ? `${inr(x.amount)}/mo × ${x.term_months}` : inr(x.amount)} · closes {date(x.close_date)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="space-y-3">{has ? children : <p className="text-sm text-zinc-400">{empty}</p>}</div>
    </section>
  );
}

function ReadBack({ d, note }: { d: RepDeal; note?: string }) {
  const a = d.analysis;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <p className="rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-700">{d.raw_text}</p>
      {a && (
        <>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">What the AI understood</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {a.records.map((r) => (
              <li key={r.name}>{describe(r)}</li>
            ))}
            {a.partner && (
              <li>
                Partner: {a.partner.name} ({a.partner.type}){a.partner.mdf_amount ? `, ${inr(a.partner.mdf_amount)} MDF kept out of revenue` : ""}.
              </li>
            )}
          </ul>
          {a.rep_label_conflict && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">About your label: {a.rep_label_conflict}</p>}
          <p className="mt-2 text-xs text-zinc-600">
            <b>Why:</b> {a.reasoning}
          </p>
        </>
      )}
      {note && <p className="mt-2 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

function AnswerCard({ d, rep, onDone, highlight }: { d: RepDeal; rep: string; onDone: () => void; highlight: boolean }) {
  const open = d.questions.filter((q) => !q.answer);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const filled = open.filter((q) => vals[q.index]?.trim());

  async function send() {
    setBusy(true);
    const now = new Date().toISOString();
    const res = await fetch("/api/rep/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        analysis_id: d.analysis!.id,
        rep_id: rep,
        answers: filled.map((q) => ({ index: q.index, question: q.question, field: q.field, record_index: q.record_index, answer: vals[q.index].trim(), answered_at: now })),
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? "Failed");
    setMsg(j.rerun ? "Sent. The agent is re-checking the deal with your answers; ops is notified." : "Sent to ops. (Automatic re-check is off or paused.)");
    setTimeout(onDone, 1500);
  }

  return (
    <div className={`rounded-lg border bg-white ${highlight ? "border-violet-400 ring-2 ring-violet-200" : "border-zinc-200"}`}>
      <ReadBack d={d} />
      <div className="border-t border-zinc-100 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
          {open.length} question{open.length === 1 ? "" : "s"} for you
        </div>
        <div className="space-y-3">
          {open.map((q) => (
            <label key={q.index} className="block text-sm">
              {q.question}
              <AnswerInput field={q.field} value={vals[q.index] ?? ""} onChange={(v) => setVals((s) => ({ ...s, [q.index]: v }))} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={send} disabled={busy || !filled.length} className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40">
            {busy ? "Sending…" : `Send ${filled.length || ""} answer${filled.length === 1 ? "" : "s"}`}
          </button>
          {msg && <span className="text-xs text-emerald-700">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function AnswerInput({ field, value, onChange }: { field: QuestionField; value: string; onChange: (v: string) => void }) {
  const cls = "mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  if (field === "close_date") return <input type="date" className={cls} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field === "partner_registered" || field === "deal_type")
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— answer —</option>
        {field === "partner_registered" ? (
          <>
            <option value="yes">Yes, registered</option>
            <option value="no">No, not yet</option>
          </>
        ) : (
          <>
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </>
        )}
      </select>
    );
  const numeric = field === "amount" || field === "partner_mdf_amount" || field === "term_months";
  return <input className={cls} inputMode={numeric ? "numeric" : undefined} value={value} placeholder={numeric ? "Number" : "Your answer"} onChange={(e) => onChange(e.target.value)} />;
}
