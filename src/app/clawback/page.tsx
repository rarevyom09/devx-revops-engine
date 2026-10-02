"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_TODAY, type ClawbackStatus, type InvoiceClawback, type OwnerRollup } from "@/lib/clawback";
import { formatDate, formatINR } from "@/lib/format";

type ClawbackResponse = {
  asOf: string;
  assumptions: { quarters: string; atRiskWindowDays: number };
  invoices: InvoiceClawback[];
  owners: OwnerRollup[];
};

const STATUS: Record<ClawbackStatus, { label: string; cls: string }> = {
  safe: { label: "Safe", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  overdue_exposure: { label: "Clawed back", cls: "bg-red-50 text-red-800 ring-red-200" },
  at_risk: { label: "At risk", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  partial: { label: "Partial", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  open: { label: "Open", cls: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
};

function Badge({ status }: { status: ClawbackStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function ClawbackPage() {
  const [asOf, setAsOf] = useState(DEMO_TODAY);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("asOf");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deep link from Try cases
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setAsOf(q);
  }, []);
  const [data, setData] = useState<ClawbackResponse | null>(null);
  const [error, setError] = useState<{ message: string; notConfigured?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return;
    let cancelled = false;
    fetch(`/api/clawback?asOf=${asOf}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError({ message: json.error ?? "Could not load clawback data", notConfigured: json.notConfigured });
          setData(null);
        } else {
          setError(null);
          setData(json);
        }
      })
      .catch((e) => !cancelled && setError({ message: String(e) }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [asOf]);

  const totals = data?.owners.reduce(
    (t, o) => ({
      at_stake: t.at_stake + o.at_stake,
      realised: t.realised + o.realised_clawback,
      projected: t.projected + o.projected_exposure,
    }),
    { at_stake: 0, realised: 0, projected: 0 },
  );

  return (
    <>
      <PageHeader title="Clawback" engine="rules">
        Every invoice must be paid by the end of the quarter after it was raised, or the owner&apos;s variable pay
        on it is clawed back in proportion to the unpaid share. Integration with finance (Zoho) is stubbed; data
        comes from the invoices and payments tables.
      </PageHeader>

      {error && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>{error.notConfigured ? "Database not reachable." : "Error."}</b> {error.message}
        </div>
      )}

      <section className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="block">
          <span className="text-sm font-medium">As-of date</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => {
              setLoading(true);
              setAsOf(e.target.value);
            }}
            className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex gap-2 text-xs">
          {[
            [DEMO_TODAY, "Today (demo)"],
            ["2026-11-15", "Fast-forward to 15 Nov"],
            ["2027-01-05", "After Q4 deadline"],
          ].map(([d, label]) => (
            <button
              key={d}
              onClick={() => {
                setLoading(true);
                setAsOf(d);
              }}
              className={`rounded-md border px-2 py-1 ${asOf === d ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-zinc-400">Loading…</span>}
      </section>

      <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
        <p>
          <b>Formula:</b> clawback = variable pay at stake × (1 − min(1, paid by deadline ÷ invoice amount)), floor 0.
          Deadline = last day of the quarter after the invoice was raised. Payments after the deadline are counted as
          cash but do not rescue variable pay.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Status order: <b>Safe</b> (fully paid by deadline) → <b>Clawed back</b> (deadline passed, clawback
          realised) → <b>At risk</b> (deadline within {data?.assumptions.atRiskWindowDays ?? 60} days) →{" "}
          <b>Partial</b> (some paid) → <b>Open</b> (nothing paid). Exposure = clawback if nothing more is paid before
          the deadline. Payments dated after the as-of date are ignored. Assumes{" "}
          {data?.assumptions.quarters ?? "calendar quarters"} (Indian FY to confirm).
        </p>
      </div>

      {totals && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Variable pay at stake" value={formatINR(totals.at_stake)} />
          <Stat label="Realised clawback" value={formatINR(totals.realised)} tone="red" />
          <Stat label="Projected exposure (open invoices)" value={formatINR(totals.projected)} tone="amber" />
        </div>
      )}

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold">Invoices</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Deal / milestone</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Raised</th>
                <th className="px-3 py-2 font-medium">Deadline</th>
                <th className="px-3 py-2 text-right font-medium">Days left</th>
                <th className="px-3 py-2 text-right font-medium">Paid by deadline</th>
                <th className="px-3 py-2 text-right font-medium">Paid after</th>
                <th className="px-3 py-2 text-right font-medium">At stake</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Clawback / exposure</th>
              </tr>
            </thead>
            <tbody>
              {data?.invoices.map((r) => {
                const value = r.status === "overdue_exposure" ? r.realised_clawback : r.projected_exposure;
                const paidPct = r.amount ? Math.min(1, r.paid_by_deadline / r.amount) : 0;
                return (
                  <tr key={r.id} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.deal_name ?? "—"}</div>
                      <div className="text-xs text-zinc-500">{r.milestone}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.owner_name ?? "Unassigned"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.amount)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(r.raised_on)}
                      <div className="text-xs text-zinc-500">{r.quarter}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.deadline)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.days_left < 0 ? "text-red-700" : ""}`}>
                      {r.days_left}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatINR(r.paid_by_deadline)}
                      <div className="text-xs text-zinc-500">{Math.round(paidPct * 1000) / 10}%</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                      {r.paid_after_deadline ? formatINR(r.paid_after_deadline) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.variable_pay_at_stake)}</td>
                    <td className="px-3 py-2">
                      <Badge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className={value > 0 ? (r.status === "overdue_exposure" ? "font-medium text-red-700" : "text-amber-700") : ""}>
                        {formatINR(value)}
                      </div>
                      {value > 0 && (
                        <div className="text-[11px] whitespace-nowrap text-zinc-500">
                          {formatINR(r.variable_pay_at_stake)} × (1 − {formatINR(r.paid_by_deadline)}/{formatINR(r.amount)})
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data && data.invoices.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-zinc-400">
                    No invoices raised on or before {formatDate(asOf)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold">Per-owner roll-up</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                <th className="px-3 py-2 text-right font-medium">Variable pay at stake</th>
                <th className="px-3 py-2 text-right font-medium">Realised clawback</th>
                <th className="px-3 py-2 text-right font-medium">Projected exposure</th>
              </tr>
            </thead>
            <tbody>
              {data?.owners.map((o) => (
                <tr key={o.owner_id ?? "unassigned"} className="border-t border-zinc-100">
                  <td className="px-3 py-2 font-medium">{o.owner_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.invoices}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(o.at_stake)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${o.realised_clawback ? "text-red-700" : ""}`}>
                    {formatINR(o.realised_clawback)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${o.projected_exposure ? "text-amber-700" : ""}`}>
                    {formatINR(o.projected_exposure)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          Clawback is computed per invoice and summed per owner (owner-quarter netting not modelled). Variable pay at
          stake is an invented 5% of invoice amount.
        </p>
      </section>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-zinc-900";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
