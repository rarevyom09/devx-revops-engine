"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EngineBadge } from "@/components/EngineBadge";
import type { ActionKind, LeakGroup, LeakItem } from "@/lib/diagnose";
import { PRACTICES } from "@/lib/integrity";
import type { Severity } from "@/lib/leaks";

type Data = { asOf: string; groups: LeakGroup[]; totals: { atStake: number; critical: number; warning: number } };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const SEV: Record<Severity, { dot: string; chip: string; border: string }> = {
  critical: { dot: "bg-red-600", chip: "bg-red-50 text-red-800 ring-red-200", border: "border-red-200" },
  warning: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 ring-amber-200", border: "border-amber-200" },
  info: { dot: "bg-zinc-400", chip: "bg-zinc-50 text-zinc-700 ring-zinc-200", border: "border-zinc-200" },
};
const STAGE: Record<string, string> = { deal: "Deal", booking: "Booking", invoice: "Invoice", cash: "Realization", margin: "Margin" };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export function DiagnosePanel({ asOf, onChanged }: { asOf: string; onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/diagnose?asOf=${asOf}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setData(json);
  }, [asOf]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on as-of change
    load();
  }, [load]);

  const changed = () => {
    load();
    onChanged?.();
  };

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Diagnose</div>
          <h2 className="text-xl font-semibold tracking-tight">Where money and margin leak today</h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            Every leak across deal → booking → invoice → cash → margin, ranked by money at stake. Expand one to see the
            next steps and run them here.
          </p>
        </div>
        {data && (
          <div className="flex gap-6 text-right">
            <Stat label="At stake now" value={inr(data.totals.atStake)} tone="text-red-700" />
            <Stat label="Critical" value={String(data.totals.critical)} tone="text-red-700" />
            <Stat label="Warnings" value={String(data.totals.warning)} tone="text-amber-700" />
          </div>
        )}
      </div>

      {error && <div className="p-5 text-sm text-amber-900">{error}</div>}
      {!data && !error && <div className="h-40 animate-pulse" />}
      {data && data.groups.length === 0 && <div className="p-5 text-sm text-emerald-700">✓ No leaks as of {data.asOf}.</div>}

      <ol className="divide-y divide-zinc-100">
        {data?.groups.map((g, n) => {
          const isOpen = open === g.key;
          return (
            <li key={g.key}>
              <button
                onClick={() => setOpen(isOpen ? null : g.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-zinc-50"
              >
                <span className="w-5 text-xs tabular-nums text-zinc-400">{n + 1}</span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEV[g.severity].dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{g.title}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {STAGE[g.stage]} · {g.count} {g.count === 1 ? "item" : "items"}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{g.leak}</span>
                </span>
                {g.impact > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums">{inr(g.impact)}</span>}
                <span className="shrink-0 text-zinc-400">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && <GroupDetail g={g} onChanged={changed} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function GroupDetail({ g, onChanged }: { g: LeakGroup; onChanged: () => void }) {
  return (
    <div className="space-y-4 bg-zinc-50/60 px-5 pb-5 pt-1 sm:pl-14">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next steps</div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-zinc-700">
          {g.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      <ul className="space-y-3">
        {g.items.map((it) => (
          <li key={it.id} className={`rounded-lg border bg-white p-3 ${SEV[it.severity].border}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{it.title}</span>
              <span className="text-xs text-zinc-500">{it.subject}</span>
              {it.impact != null && <span className="ml-auto text-sm font-semibold tabular-nums">{inr(it.impact)}</span>}
            </div>
            <p className="mt-0.5 text-sm text-zinc-600">{it.detail}</p>
            {it.draft && <DraftView d={it.draft} onChanged={onChanged} />}
            <div className="mt-2 flex flex-wrap gap-2">
              {g.actions.map((a) => (
                <Action key={a} kind={a} item={it} onChanged={onChanged} />
              ))}
              <Link href={it.href} className="rounded-md px-2 py-1 text-xs text-zinc-500 underline hover:text-zinc-900">
                Open in {it.href === "/" ? "inbox" : it.href.slice(1)}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const btn = "rounded-md border px-2.5 py-1 text-xs disabled:opacity-40";
const aiBtn = `${btn} border-violet-300 text-violet-800 hover:bg-violet-50`;
const plainBtn = `${btn} border-zinc-300 hover:bg-zinc-100`;

function Action({ kind, item, onChanged }: { kind: ActionKind; item: LeakItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<React.ReactNode>(null);
  const [form, setForm] = useState(false);
  const dealId = item.ref.deal_id;

  async function run(fn: () => Promise<React.ReactNode>) {
    setBusy(true);
    try {
      setResult(await fn());
    } finally {
      setBusy(false);
    }
  }
  const fail = (r: { json: { error?: string; ai_error?: { reason: string; detail: string } } }) =>
    r.json.ai_error ? (
      <Note tone="amber">AI unavailable ({r.json.ai_error.reason}): {r.json.ai_error.detail}. Nothing was guessed.</Note>
    ) : (
      <Note tone="red">{r.json.error ?? "Failed"}</Note>
    );

  const wrap = (button: React.ReactNode, extra?: React.ReactNode) => (
    <div className="w-full sm:w-auto">
      {button}
      {extra}
      {result && <div className="mt-2">{result}</div>}
    </div>
  );

  switch (kind) {
    case "analyse":
      return wrap(
        <button
          className={aiBtn}
          disabled={busy}
          onClick={() =>
            confirm("Run the integrity agent on this deal? Uses 1 AI call.") &&
            run(async () => {
              const r = await post("/api/pipeline/analyse", { raw_deal_id: item.ref.id });
              if (!r.ok || r.json.ai_unavailable) return fail({ json: r.json.ai_unavailable ? { ai_error: { reason: r.json.reason, detail: r.json.detail } } : r.json });
              onChanged();
              const a = r.json.analysis;
              return (
                <Note tone="violet">
                  Analysed: {a.output.records.length} record(s), {a.confidence} confidence
                  {a.output.is_blended ? ", blended deal detected" : ""}.{" "}
                  <Link className="underline" href={`/pipeline?raw=${item.ref.id}`}>Review and approve →</Link>
                </Note>
              );
            })
          }
        >
          {busy ? "Claude is reading…" : "Analyse with AI"} <EngineBadge engine="ai" />
        </button>,
      );
    case "review":
      return wrap(
        <Link href={`/pipeline?raw=${item.ref.id}`} className={plainBtn}>
          Review and approve →
        </Link>,
      );
    case "draft_brief":
      if (!dealId) return null;
      return wrap(
        <button
          className={aiBtn}
          disabled={busy}
          onClick={() =>
            confirm("Draft the onboarding brief and billing milestones? Uses 1 AI call.") &&
            run(async () => {
              const r = await post("/api/onboarding/draft", { deal_id: dealId });
              if (!r.ok) return fail(r);
              onChanged();
              if (r.json.ai_error) return <>{fail(r)} <Link className="text-xs underline" href="/onboarding">Write it manually →</Link></>;
              const ms = r.json.brief?.milestones ?? [];
              return (
                <Note tone="violet">
                  Draft saved: {ms.length} milestone(s) ({ms.map((m: { name: string; pct: number }) => `${m.name} ${m.pct}%`).join(", ")}).
                  Needs human approval before invoices exist.{" "}
                  <Link className="underline" href="/onboarding">Approve in Onboarding →</Link>
                </Note>
              );
            })
          }
        >
          {busy ? "Drafting…" : "Draft brief with AI"} <EngineBadge engine="ai" />
        </button>,
      );
    case "assist":
      if (!dealId) return null;
      return wrap(
        <button
          className={aiBtn}
          disabled={busy}
          onClick={() =>
            confirm("Ask AI to draft the next step (e.g. a payment chase or change request)? Uses 1 AI call.") &&
            run(async () => {
              const r = await post("/api/deals/assist", { deal_id: dealId });
              if (!r.ok || r.json.ai_error) return fail(r);
              const a = r.json.assist;
              const unverified: number[] = r.json.unverified_amounts ?? [];
              return (
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/50 p-3 text-sm">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-violet-800">AI draft — not sent, not saved</div>
                  <p>{a.situation}</p>
                  <ul className="list-disc pl-5 text-zinc-700">
                    {a.next_steps.map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  {a.draft_message && (
                    <div className="rounded border border-zinc-200 bg-white p-2 text-xs">
                      <div><b>To:</b> {a.draft_message.to}</div>
                      <div><b>Subject:</b> {a.draft_message.subject}</div>
                      <p className="mt-1 whitespace-pre-wrap">{a.draft_message.body}</p>
                      <button
                        className="mt-1 underline"
                        onClick={() => navigator.clipboard.writeText(`To: ${a.draft_message.to}\nSubject: ${a.draft_message.subject}\n\n${a.draft_message.body}`)}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  {unverified.length > 0 ? (
                    <Note tone="red">Check before sending: {unverified.map(inr).join(", ")} not found in this deal&apos;s data.</Note>
                  ) : (
                    <p className="text-xs text-emerald-700">✓ Every ₹ figure matches the deal&apos;s data.</p>
                  )}
                </div>
              );
            })
          }
        >
          {busy ? "Claude is thinking…" : item.draft?.status === "ready" ? "Redraft" : "Draft next step"} <EngineBadge engine="ai" />
        </button>,
      );
    case "record_payment":
      if (!item.deal_name || !item.milestone) return null;
      return wrap(
        <button className={plainBtn} onClick={() => setForm((f) => !f)}>
          Record payment
        </button>,
        form && (
          <InlineForm
            fields={[
              { key: "amount", label: "Amount ₹", initial: String(item.outstanding ?? "") },
              { key: "paid_on", label: "Paid on", initial: new Date().toISOString().slice(0, 10), type: "date" },
            ]}
            submitLabel="Save payment"
            onSubmit={async (v) => {
              const r = await post("/api/ingest", {
                table: "payments",
                source: "form",
                dryRun: false,
                rows: [{ deal_name: item.deal_name, milestone: item.milestone, amount: v.amount, paid_on: v.paid_on }],
              });
              const errs = r.json.results?.flatMap((x: { errors: string[] }) => x.errors) ?? [];
              if (!r.ok || errs.length) return r.json.error ?? errs.join("; ");
              setForm(false);
              setResult(<Note tone="green">Payment recorded against {item.milestone}. Exposure recalculated.</Note>);
              onChanged();
              return null;
            }}
          />
        ),
      );
    case "log_hours":
      if (!item.deal_name) return null;
      return wrap(
        <button className={plainBtn} onClick={() => setForm((f) => !f)}>
          Log hours
        </button>,
        form && (
          <InlineForm
            fields={[
              { key: "location", label: "Location", initial: "IN", options: ["IN", "SG"] },
              { key: "hours", label: "Hours", initial: "" },
              { key: "logged_on", label: "Date", initial: new Date().toISOString().slice(0, 10), type: "date" },
            ]}
            submitLabel="Save hours"
            onSubmit={async (v) => {
              const r = await post("/api/ingest", { table: "timesheets", source: "form", dryRun: false, rows: [{ deal_name: item.deal_name, ...v }] });
              const errs = r.json.results?.flatMap((x: { errors: string[] }) => x.errors) ?? [];
              if (!r.ok || errs.length) return r.json.error ?? errs.join("; ");
              setForm(false);
              setResult(<Note tone="green">Hours logged. Margin recalculated.</Note>);
              onChanged();
              return null;
            }}
          />
        ),
      );
    case "mark_registered":
      if (!dealId) return null;
      return wrap(
        <button
          className={plainBtn}
          disabled={busy}
          onClick={() =>
            confirm("Confirm the deal is registered with the partner?") &&
            run(async () => {
              const r = await post("/api/deals/update", { action: "mark_registered", deal_id: dealId });
              if (!r.ok) return fail(r);
              onChanged();
              return <Note tone="green">Marked registered.</Note>;
            })
          }
        >
          Mark registered
        </button>,
      );
    case "set_practice":
      if (!dealId) return null;
      return wrap(
        <button className={plainBtn} onClick={() => setForm((f) => !f)}>
          Set practice split
        </button>,
        form && (
          <InlineForm
            fields={PRACTICES.map((p) => ({ key: p, label: `${p} %`, initial: "" }))}
            submitLabel="Save split"
            onSubmit={async (v) => {
              const split = Object.fromEntries(
                Object.entries(v)
                  .filter(([, x]) => x.trim())
                  .map(([k, x]) => [k, Number(x) / 100]),
              );
              const r = await post("/api/deals/update", { action: "set_practice", deal_id: dealId, practice_split: split });
              if (!r.ok) return r.json.error ?? "Failed";
              setForm(false);
              setResult(<Note tone="green">Practice split saved.</Note>);
              onChanged();
              return null;
            }}
          />
        ),
      );
  }
}

// A follow-up the system drafted on its own when this leak appeared.
function DraftView({ d, onChanged }: { d: NonNullable<LeakItem["draft"]>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (d.status === "dismissed") return null;
  if (d.status === "drafting") return <Note tone="violet">Drafting a follow-up automatically…</Note>;
  if (d.status === "failed") return <Note tone="amber">Automatic follow-up draft failed ({d.detail}). Use Draft next step.</Note>;
  const a = d.assist;
  if (!a) return null;
  const unverified = d.unverified_amounts ?? [];
  const mark = async (status: "sent" | "dismissed") => {
    setBusy(true);
    await post("/api/drafts", { id: d.id, status });
    setBusy(false);
    onChanged();
  };
  return (
    <div className={`mt-2 space-y-2 rounded-md border p-3 text-sm ${d.status === "sent" ? "border-emerald-200 bg-emerald-50/50" : "border-violet-200 bg-violet-50/50"}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-violet-800">
        Drafted automatically when this leak appeared · not sent
        {d.status === "sent" && <span className="rounded bg-emerald-100 px-1.5 text-emerald-800">marked sent</span>}
      </div>
      <p>{a.situation}</p>
      <ul className="list-disc pl-5 text-zinc-700">
        {a.next_steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {a.draft_message && (
        <div className="rounded border border-zinc-200 bg-white p-2 text-xs">
          <div><b>To:</b> {a.draft_message.to}</div>
          <div><b>Subject:</b> {a.draft_message.subject}</div>
          <p className="mt-1 whitespace-pre-wrap">{a.draft_message.body}</p>
        </div>
      )}
      {unverified.length > 0 ? (
        <Note tone="red">Check before sending: {unverified.map(inr).join(", ")} not found in this deal&apos;s data.</Note>
      ) : (
        <p className="text-xs text-emerald-700">✓ Every ₹ figure matches the deal&apos;s data.</p>
      )}
      {d.status === "ready" && (
        <div className="flex flex-wrap gap-2">
          {a.draft_message && (
            <button
              className={plainBtn}
              onClick={() => navigator.clipboard.writeText(`To: ${a.draft_message!.to}\nSubject: ${a.draft_message!.subject}\n\n${a.draft_message!.body}`)}
            >
              Copy message
            </button>
          )}
          <button className={plainBtn} disabled={busy} onClick={() => mark("sent")}>
            Mark sent
          </button>
          <button className={plainBtn} disabled={busy} onClick={() => mark("dismissed")}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

type Field = { key: string; label: string; initial: string; type?: string; options?: string[] };

function InlineForm({ fields, submitLabel, onSubmit }: { fields: Field[]; submitLabel: string; onSubmit: (v: Record<string, string>) => Promise<string | null> }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initial])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cls = "mt-0.5 block w-28 rounded-md border border-zinc-300 px-2 py-1 text-sm";
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-white p-2">
      {fields.map((f) => (
        <label key={f.key} className="text-xs text-zinc-600">
          {f.label}
          {f.options ? (
            <select className={cls} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input type={f.type ?? "text"} className={cls} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      <button
        disabled={busy}
        className="rounded-md bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40"
        onClick={async () => {
          setBusy(true);
          setErr(await onSubmit(v));
          setBusy(false);
        }}
      >
        {busy ? "Saving…" : submitLabel}
      </button>
      {err && <span className="w-full text-xs text-red-700">{err}</span>}
    </div>
  );
}

const NOTE = {
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  violet: "border-violet-200 bg-violet-50 text-violet-900",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
function Note({ tone, children }: { tone: keyof typeof NOTE; children: React.ReactNode }) {
  return <div className={`rounded-md border px-2.5 py-1.5 text-xs ${NOTE[tone]}`}>{children}</div>;
}
