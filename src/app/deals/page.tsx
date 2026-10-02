"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EngineBadge } from "@/components/EngineBadge";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, formatINR, formatPct } from "@/lib/format";
import type { Severity } from "@/lib/leaks";
import type { Board, BoardCard, ColumnKey, InvoiceLine } from "@/lib/snapshot";

type Assist = {
  situation: string;
  next_steps: string[];
  draft_message: { to: string; subject: string; body: string } | null;
};

const SEV: Record<Severity, { dot: string; chip: string }> = {
  critical: { dot: "bg-red-600", chip: "bg-red-50 text-red-800 ring-red-200" },
  warning: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 ring-amber-200" },
  info: { dot: "bg-zinc-400", chip: "bg-zinc-50 text-zinc-700 ring-zinc-200" },
};
const COL_ACCENT: Record<ColumnKey, string> = {
  intake: "bg-zinc-400",
  review: "bg-violet-500",
  booked: "bg-sky-500",
  onboarded: "bg-indigo-500",
  invoicing: "bg-amber-500",
  collected: "bg-emerald-500",
};
const INV_STATUS: Record<InvoiceLine["status"], { label: string; cls: string }> = {
  scheduled: { label: "scheduled", cls: "bg-zinc-100 text-zinc-600" },
  open: { label: "open", cls: "bg-sky-100 text-sky-800" },
  partial: { label: "partial", cls: "bg-amber-100 text-amber-800" },
  at_risk: { label: "at risk", cls: "bg-amber-100 text-amber-900" },
  overdue_exposure: { label: "clawback", cls: "bg-red-100 text-red-800" },
  safe: { label: "paid", cls: "bg-emerald-100 text-emerald-800" },
};

export default function DealPipelinePage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/deals", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setBoard(json);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const card = board?.cards.find((c) => c.key === selected) ?? null;
  const deals = board?.cards.filter((c) => c.kind === "deal").length ?? 0;
  const raws = board?.cards.filter((c) => c.kind === "raw").length ?? 0;

  return (
    <>
      <PageHeader title="Deal Pipeline" engine="ai">
        Every deal at its current stage, from the rep&apos;s raw description to cash collected. Stages are derived
        from the data; alerts come from the same rules as the home page. Click a deal to see what exists and what is
        missing at each stage.
      </PageHeader>

      {error && <Banner tone="amber">{error}</Banner>}

      {board && (
        <p className="mb-3 text-sm text-zinc-600">
          As of {formatDate(board.asOf)} · {deals} approved deal{deals === 1 ? "" : "s"} · {raws} raw description
          {raws === 1 ? "" : "s"} in progress
          {board.rejected > 0 && <span className="text-zinc-400"> · {board.rejected} rejected (hidden)</span>}
        </p>
      )}

      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-3">
          {(board?.columns ?? []).map((col) => {
            const cards = board!.cards.filter((c) => c.column === col.key);
            return (
              <section key={col.key} className="flex w-72 shrink-0 flex-col rounded-lg bg-zinc-100/70 p-2">
                <header className="mb-2 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${COL_ACCENT[col.key]}`} />
                    <h2 className="text-sm font-semibold">{col.label}</h2>
                    <span className="ml-auto rounded-full bg-white px-2 text-xs tabular-nums text-zinc-600 ring-1 ring-zinc-200">
                      {cards.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{col.hint}</p>
                </header>
                <div className="space-y-2">
                  {cards.map((c) => (
                    <DealCard key={c.key} c={c} active={c.key === selected} onOpen={setSelected} />
                  ))}
                  {cards.length === 0 && (
                    <div className="rounded-md border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-400">
                      Nothing here
                    </div>
                  )}
                </div>
              </section>
            );
          })}
          {!board &&
            !error &&
            Array.from({ length: 6 }, (_, i) => <div key={i} className="h-64 w-72 shrink-0 animate-pulse rounded-lg bg-zinc-100" />)}
        </div>
      </div>

      {card && (
        <>
          <div className="fixed inset-0 z-30 bg-zinc-900/20" onClick={() => setSelected(null)} />
          <aside className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto bg-zinc-50 shadow-xl sm:max-w-xl">
            <DealDetail key={card.key} c={card} board={board!} onClose={() => setSelected(null)} onOpen={setSelected} />
          </aside>
        </>
      )}
    </>
  );
}

function typeLine(c: Pick<BoardCard, "deal_type" | "amount" | "term_months">) {
  if (!c.deal_type || c.amount == null) return null;
  return c.deal_type === "recurring" ? `Recurring · ${formatINR(c.amount)}/mo × ${c.term_months ?? "?"}` : "One-time";
}

function DealCard({ c, active, onOpen }: { c: BoardCard; active: boolean; onOpen: (k: string) => void }) {
  const border = c.counts.critical ? "border-red-300" : c.counts.warning ? "border-amber-300" : "border-zinc-200";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(c.key)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c.key))}
      className={`block w-full cursor-pointer rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-zinc-400 ${border} ${
        active ? "ring-2 ring-zinc-900" : ""
      }`}
    >
      <div className={`font-medium leading-snug ${c.kind === "raw" ? "line-clamp-3 font-normal text-zinc-700" : ""}`}>{c.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
        <span>{c.owner ?? "unassigned"}</span>
        {typeLine(c) && <span>· {typeLine(c)}</span>}
      </div>
      {c.kind === "deal" && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="font-semibold tabular-nums">{formatINR(c.total)}</span>
          <span className="text-xs text-zinc-500">close {formatDate(c.close_date)}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {c.status_label && <Chip cls="bg-emerald-50 text-emerald-800 ring-emerald-200">{c.status_label}</Chip>}
        {c.partner && <Chip cls="bg-orange-50 text-orange-800 ring-orange-200">{c.partner}</Chip>}
        {c.kind === "raw" && c.confidence && <ConfidenceBadge c={c.confidence} />}
        {c.kind === "raw" && c.flag_count > 0 && <Chip cls="bg-red-50 text-red-800 ring-red-200">{c.flag_count} flag{c.flag_count === 1 ? "" : "s"}</Chip>}
        {c.kind === "raw" && c.open_questions > 0 && (
          <Chip cls="bg-violet-50 text-violet-800 ring-violet-200">{c.open_questions} open question{c.open_questions === 1 ? "" : "s"}</Chip>
        )}
        {(["critical", "warning"] as const).map((k) =>
          c.counts[k] ? (
            <Chip key={k} cls={SEV[k].chip}>
              {c.counts[k]} {k}
            </Chip>
          ) : null,
        )}
      </div>
      {c.split && (
        <div className="mt-2 text-[11px] text-violet-700">
          ⑂ split from 1 description
          {c.split.siblings.length > 0 && <> with {c.split.siblings.map((s) => s.name).join(", ")}</>}
        </div>
      )}
      <div className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-700">
        <span className="text-zinc-400">Next:</span> {c.next_action.label}
      </div>
    </div>
  );
}

function DealDetail({ c, board, onClose, onOpen }: { c: BoardCard; board: Board; onClose: () => void; onOpen: (k: string) => void }) {
  const col = board.columns.find((x) => x.key === c.column)!;
  const raised = c.invoices.filter((i) => i.raised);
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={`h-2 w-2 rounded-full ${COL_ACCENT[c.column]}`} />
            {col.label}
            {c.status_label && <span>· {c.status_label}</span>}
          </div>
          <h2 className={`mt-1 font-semibold leading-snug ${c.kind === "raw" ? "text-base" : "text-lg"}`}>
            {c.kind === "raw" ? "Raw deal description" : c.title}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {c.owner ?? "unassigned"}
            {typeLine(c) && ` · ${typeLine(c)}`}
            {c.total != null && ` · ${formatINR(c.total)}`}
          </p>
        </div>
        <button onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-sm hover:bg-zinc-100" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm">
        <span className="text-zinc-400">Next action:</span>{" "}
        <Link href={c.next_action.href} className="font-medium underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
          {c.next_action.label} →
        </Link>
      </div>

      {c.kind === "deal" && <AssistPanel c={c} />}

      <Section n={1} title="Integrity" href="/pipeline" engine="ai" done={c.kind === "deal"}>
        {c.intake ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-2.5 font-mono text-xs text-zinc-800">{c.intake.raw_text}</p>
            {c.intake.analysis ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <ConfidenceBadge c={c.intake.analysis.confidence} />
                  <span>analysed {formatDate(c.intake.analysis.analysed_at)}</span>
                  {c.intake.analysis.proposed.length > 0 && <span>· proposed: {c.intake.analysis.proposed.join(" + ")}</span>}
                </div>
                {c.intake.analysis.flags.length > 0 ? (
                  <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
                    {c.intake.analysis.flags.map((f, i) => (
                      <li key={i}>
                        <b>{f.code}</b>: {f.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-emerald-700">✓ All validator checks passed</p>
                )}
                {c.intake.analysis.questions.length > 0 && (
                  <ul className="space-y-1.5 text-xs">
                    {c.intake.analysis.questions.map((q, i) => (
                      <li key={i} className="rounded-md border border-zinc-200 p-2">
                        <div className="text-zinc-700">Q: {q.question}</div>
                        <div className={q.answer ? "mt-0.5 text-emerald-800" : "mt-0.5 text-amber-700"}>
                          {q.answer ? `A: ${q.answer}` : "Not answered yet"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Missing>Not analysed yet. Run the integrity agent in Deal Integrity.</Missing>
            )}
            {c.deal && (
              <p className="text-xs text-zinc-500">
                Approved by <b>{c.deal.approved_by ?? "—"}</b> on {formatDate(c.deal.approved_at)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            Entered directly (no raw description on file). Approved by {c.deal?.approved_by ?? "—"}
            {c.deal?.approved_at && ` on ${formatDate(c.deal.approved_at)}`}.
          </p>
        )}
      </Section>

      <Section n={2} title="Booking" href="/pipeline" engine="data" done={!!c.deal}>
        {c.deal ? (
          <div className="space-y-2 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <Field k="Type" v={c.deal.deal_type === "recurring" ? "Recurring" : "One-time"} />
              <Field k={c.deal.deal_type === "recurring" ? "Monthly" : "Amount"} v={formatINR(c.deal.amount)} />
              {c.deal.term_months && <Field k="Term" v={`${c.deal.term_months} months (ends ${formatDate(c.deal.term_end)})`} />}
              <Field k="Contract value" v={formatINR(c.deal.total)} />
              <Field k={c.deal.deal_type === "recurring" ? "First billing" : "Project end"} v={formatDate(c.deal.close_date)} />
              <Field
                k="Practice split"
                v={
                  c.deal.practice_split && Object.keys(c.deal.practice_split).length
                    ? Object.entries(c.deal.practice_split).map(([p, x]) => `${p} ${Math.round(Number(x) * 100)}%`).join(" / ")
                    : <span className="text-amber-700">missing</span>
                }
              />
              <Field
                k="Partner"
                v={
                  c.deal.partner
                    ? `${c.deal.partner} · reg ${c.deal.partner_flags?.deal_registered === true ? "✓" : c.deal.partner_flags?.deal_registered === false ? "missing" : "unconfirmed"}${c.deal.partner_flags?.mdf_amount ? ` · MDF ${formatINR(c.deal.partner_flags.mdf_amount)}` : ""}`
                    : "none"
                }
              />
            </dl>
            {c.split && (
              <p className="text-xs text-violet-700">
                ⑂ Split from one description. Sibling record{c.split.siblings.length === 1 ? "" : "s"}:{" "}
                {c.split.siblings.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <button onClick={() => onOpen(`deal:${s.id}`)} className="underline underline-offset-2">
                      {s.name}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
        ) : (
          <Missing>No deal record yet. Nothing is booked until a human approves the proposal.</Missing>
        )}
      </Section>

      {c.kind === "deal" && (
        <>
          <Section n={3} title="Onboarding" href="/onboarding" engine="ai" done={c.brief?.status === "approved"}>
            {c.brief ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  Brief <b className={c.brief.status === "approved" ? "text-emerald-700" : "text-amber-700"}>{c.brief.status}</b>
                  {c.brief.approved_by && ` by ${c.brief.approved_by} on ${formatDate(c.brief.approved_at)}`}
                </p>
                {c.brief.milestones.length > 0 && (
                  <Table
                    head={["Milestone", "%", "Due"]}
                    rows={c.brief.milestones.map((m) => [m.name, `${m.pct}%`, formatDate(m.due_date)])}
                  />
                )}
              </div>
            ) : c.invoices.length ? (
              <p className="text-xs text-zinc-500">No brief on file (historical deal with invoices already raised).</p>
            ) : (
              <Missing>No onboarding brief. Without approved milestones nothing gets invoiced.</Missing>
            )}
          </Section>

          <Section n={4} title="Invoices & cash" href="/clawback" engine="rules" done={c.column === "collected"}>
            {c.invoices.length ? (
              <div className="space-y-2">
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[460px] text-xs">
                    <thead className="text-left text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Milestone</th>
                        <th className="py-1 pr-2 text-right font-medium">Amount</th>
                        <th className="py-1 pr-2 font-medium">Raised</th>
                        <th className="py-1 pr-2 text-right font-medium">Paid</th>
                        <th className="py-1 pr-2 font-medium">Deadline</th>
                        <th className="py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {c.invoices.map((i) => (
                        <tr key={i.id} className={i.raised ? "" : "text-zinc-400"}>
                          <td className="py-1.5 pr-2">{i.milestone}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{formatINR(i.amount)}</td>
                          <td className="py-1.5 pr-2">{i.raised ? formatDate(i.raised_on) : `sched. ${formatDate(i.raised_on)}`}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{formatINR(i.paid)}</td>
                          <td className="py-1.5 pr-2">
                            {i.deadline ? (
                              <>
                                {formatDate(i.deadline)}
                                {i.status !== "safe" && i.days_left != null && (
                                  <span className={i.days_left < 0 ? "text-red-700" : "text-zinc-500"}>
                                    {" "}({i.days_left < 0 ? `${-i.days_left}d late` : `${i.days_left}d`})
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${INV_STATUS[i.status].cls}`}>
                              {INV_STATUS[i.status].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-zinc-500">
                  {raised.length} raised · {formatINR(raised.reduce((t, i) => t + i.outstanding, 0))} outstanding · variable pay at stake{" "}
                  {formatINR(raised.reduce((t, i) => t + i.variable_pay_at_stake, 0))}
                  {raised.some((i) => i.realised_clawback > 0) && (
                    <b className="text-red-700"> · {formatINR(raised.reduce((t, i) => t + i.realised_clawback, 0))} clawed back</b>
                  )}
                  {raised.some((i) => i.projected_exposure > 0) && (
                    <> · {formatINR(raised.reduce((t, i) => t + i.projected_exposure, 0))} exposure if unpaid</>
                  )}
                </p>
              </div>
            ) : (
              <Missing>No invoices raised or scheduled.</Missing>
            )}
          </Section>

          <Section n={5} title="Margin" href="/margin" engine="rules" done={c.margin?.status === "on_target"}>
            {c.margin && c.margin.status !== "no_hours" ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <Field k="Hours" v={`${c.margin.hours.IN}h IN + ${c.margin.hours.SG}h SG`} />
                <Field k="Cost" v={formatINR(c.margin.cost)} />
                <Field k="Price" v={formatINR(c.margin.price)} />
                <Field
                  k="Margin"
                  v={
                    <span className={c.margin.status === "warning" ? "font-semibold text-red-700" : c.margin.status === "below_target" ? "text-amber-700" : "text-emerald-700"}>
                      {formatPct(c.margin.margin_pct)} ({c.margin.status.replace("_", " ")})
                    </span>
                  }
                />
              </dl>
            ) : (
              <Missing>No timesheet hours logged, so margin is not visible yet.</Missing>
            )}
          </Section>
        </>
      )}

      <Section title={`Alerts (${c.alerts.length})`} href="/" engine="rules" done={c.alerts.length === 0}>
        {c.alerts.length ? (
          <ul className="space-y-2">
            {c.alerts.map((a) => (
              <li key={a.id} className="flex gap-2 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV[a.severity].dot}`} />
                <div className="min-w-0">
                  <div className="font-medium">{a.title}</div>
                  <p className="text-xs text-zinc-600">{a.detail}</p>
                  <Link href={a.href} className="text-xs underline underline-offset-2">
                    {a.action} →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-emerald-700">✓ No leaks on this deal.</p>
        )}
      </Section>
    </div>
  );
}

function AssistPanel({ c }: { c: BoardCard }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Assist | null>(null);
  const [unverified, setUnverified] = useState<number[]>([]);
  const [fail, setFail] = useState<{ reason: string; detail: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    setFail(null);
    try {
      const res = await fetch("/api/deals/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: c.id }),
      });
      const json = await res.json();
      if (json.ai_error) setFail(json.ai_error);
      else if (!res.ok) setFail({ reason: "error", detail: json.error ?? `HTTP ${res.status}` });
      else {
        setOut(json.assist);
        setUnverified(json.unverified_amounts ?? []);
      }
    } catch (e) {
      setFail({ reason: "network", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const m = out?.draft_message;
    if (!m) return;
    await navigator.clipboard.writeText(`To: ${m.to}\nSubject: ${m.subject}\n\n${m.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">AI next step</h3>
        <EngineBadge engine="ai" />
        <button
          onClick={run}
          disabled={busy}
          className="ml-auto rounded-md bg-violet-700 px-3 py-1.5 text-sm text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {busy ? "Claude is thinking…" : out ? "Ask again" : "Suggest next step"}
        </button>
      </div>
      {!out && !fail && (
        <p className="mt-2 text-xs text-zinc-500">
          On demand only (uses one AI call). Claude reads this deal&apos;s facts, alerts, invoices and margin and drafts a
          next step. Nothing is sent or saved.
        </p>
      )}
      {fail && (
        <div className="mt-3">
          <Banner tone="amber">
            <b>AI unavailable ({fail.reason}).</b> {fail.detail}. Use the next action and alerts above; nothing was guessed.
          </Banner>
        </div>
      )}
      {out && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded bg-violet-50 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-violet-800">
            AI draft — not sent, not saved
          </div>
          {unverified.length > 0 ? (
            <Banner tone="red">
              <b>Check before sending:</b> {unverified.map((n) => `₹${n.toLocaleString("en-IN")}`).join(", ")} in this draft
              {unverified.length === 1 ? " does" : " do"} not match any figure on this deal.
            </Banner>
          ) : (
            <p className="text-xs text-emerald-700">✓ Every ₹ figure in this draft matches the deal&apos;s data.</p>
          )}
          <p className="text-zinc-800">{out.situation}</p>
          {out.next_steps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-zinc-800">
              {out.next_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {out.draft_message ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="mb-2 flex items-start gap-2 text-xs">
                <div className="min-w-0 flex-1 space-y-0.5 text-zinc-600">
                  <div>
                    <span className="text-zinc-400">To:</span> {out.draft_message.to}
                  </div>
                  <div>
                    <span className="text-zinc-400">Subject:</span> <b className="text-zinc-800">{out.draft_message.subject}</b>
                  </div>
                </div>
                <button onClick={copy} className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-100">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs text-zinc-800">{out.draft_message.body}</p>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No message needed right now.</p>
          )}
          <p className="text-[11px] text-zinc-400">Check every number against the sections below before sending.</p>
        </div>
      )}
    </div>
  );
}

function Section({ n, title, href, engine, done, children }: {
  n?: number;
  title: string;
  href: string;
  engine: "ai" | "rules" | "data";
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${done ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>
          {done ? "✓" : (n ?? "!")}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <EngineBadge engine={engine} />
        <Link href={href} className="ml-auto text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900">
          Open {href === "/" ? "inbox" : href.slice(1)} →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-zinc-800">{v}</dd>
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-zinc-500">
        <tr>
          {head.map((h) => (
            <th key={h} className="py-1 pr-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((x, j) => (
              <td key={j} className="py-1.5 pr-2">
                {x}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2.5 text-xs text-amber-900">Missing: {children}</p>;
}

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${cls}`}>{children}</span>;
}

function ConfidenceBadge({ c }: { c: "high" | "medium" | "low" }) {
  const s = { high: "bg-emerald-100 text-emerald-800", medium: "bg-amber-100 text-amber-800", low: "bg-red-100 text-red-800" }[c];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${s}`}>{c} confidence</span>;
}

const TONES = {
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-300 bg-red-50 text-red-900",
};
function Banner({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <div className={`mb-4 rounded-lg border p-3 text-sm ${TONES[tone]}`}>{children}</div>;
}
