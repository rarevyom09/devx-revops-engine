"use client";
import { useEffect, useState } from "react";

type Row = { name: string; invoiced: number; collected: number; at_stake: number; realised_clawback: number; projected_exposure: number };
type Data = {
  owners: Row[];
  practices: Row[];
  unattributed: Row & { deals: string[] };
  totals: { invoiced: number; ownerCredit: number; practiceCredit: number; totalCredit: number };
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function AttributionPanel({ asOf, version }: { asOf: string; version: number }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/attribution?asOf=${asOf}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && j && setD(j));
    return () => {
      live = false;
    };
  }, [asOf, version]);
  if (!d) return <div className="mb-8 h-48 animate-pulse rounded-xl border border-zinc-200 bg-white" />;
  const t = d.totals;

  const table = (title: string, note: string, rows: Row[]) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-sm font-semibold">{title}</div>
      <div className="mb-2 text-xs text-zinc-500">{note}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-xs">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Credited to</th>
              <th className="py-1 pr-2 text-right font-medium">Invoiced credit</th>
              <th className="py-1 pr-2 text-right font-medium">Collected</th>
              <th className="py-1 pr-2 text-right font-medium">Var. pay at stake</th>
              <th className="py-1 text-right font-medium">Clawback (realised / at risk)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-zinc-100">
                <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{inr(r.invoiced)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{inr(r.collected)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{inr(r.at_stake)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  <span className={r.realised_clawback ? "text-red-700" : ""}>{inr(r.realised_clawback)}</span>
                  {" / "}
                  <span className={r.projected_exposure ? "text-amber-700" : ""}>{inr(r.projected_exposure)}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-zinc-400">Nothing invoiced yet as of {asOf}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">Attribution</div>
        <h2 className="text-xl font-semibold tracking-tight">Double bubble: who gets credit for invoiced revenue</h2>
        <p className="mt-0.5 text-sm text-zinc-600">
          Every invoiced rupee credits the consulting owner 100% <i>and</i> the practice team(s) by their pillar split, so
          total credit is about twice the invoiced amount by design. Clawback follows the same split.
        </p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span>Invoiced <b className="tabular-nums">{inr(t.invoiced)}</b></span>
          <span className="text-zinc-400">→</span>
          <span>owner credit <b className="tabular-nums">{inr(t.ownerCredit)}</b></span>
          <span className="text-zinc-400">+</span>
          <span>practice credit <b className="tabular-nums">{inr(t.practiceCredit)}</b></span>
          <span className="text-zinc-400">=</span>
          <span>total credit <b className="tabular-nums">{inr(t.totalCredit)}</b></span>
        </div>
      </div>
      <div className="flex flex-col gap-6 p-5 lg:flex-row">
        {table("Bubble 1 · Consulting owners", "100% of each deal they own", d.owners)}
        {table("Bubble 2 · Practice teams", "Share of each deal by pillar split", d.practices)}
      </div>
      {d.unattributed.invoiced > 0 && (
        <div className="mx-5 mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <b>{inr(d.unattributed.invoiced)} invoiced with no practice split</b>, so practice teams can&apos;t be credited for:{" "}
          {d.unattributed.deals.join(", ")}. Fix it from Diagnose → &quot;No practice attribution&quot; → Set practice split.
        </div>
      )}
    </section>
  );
}
