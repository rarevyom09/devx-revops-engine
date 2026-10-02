"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Value = {
  headline: {
    correctionRate: number | null;
    corrected: number;
    analysed: number;
    medianBriefMin: number | null;
    briefsApproved: number;
    arrProtected: number;
    clawbackSurprises: number;
    exposureVisible: number;
    minDaysToAct: number | null;
    hoursSaved: number;
    aiCalls: number;
    aiCostUsd: number;
  };
  rows: { pain: string; cost: string; does: string; evidence: { label: string; value: string }[]; href: string; ok: boolean }[];
  assumptions: Record<string, number>;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dur = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`);

export function ValuePanel({ asOf, version }: { asOf: string; version: number }) {
  const [v, setV] = useState<Value | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/value?asOf=${asOf}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (live) setV(j);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [asOf, version]);

  if (error) return <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>;
  if (!v) return <div className="mb-8 h-64 animate-pulse rounded-xl border border-zinc-200 bg-white" />;
  const h = v.headline;

  const tiles: { label: string; value: string; sub: string; good?: boolean }[] = [
    {
      label: "Deals corrected at entry",
      value: h.correctionRate == null ? "—" : `${Math.round(h.correctionRate * 100)}%`,
      sub: h.analysed ? `${h.corrected} of ${h.analysed} analysed deals needed a fix the AI caught` : "Analyse deals to measure",
    },
    {
      label: "Deal close → delivery brief",
      value: h.medianBriefMin == null ? "—" : dur(h.medianBriefMin),
      sub: h.briefsApproved ? `median over ${h.briefsApproved} approved brief(s); manual today: days` : "No briefs approved yet",
    },
    {
      label: "ARR kept out of one-time",
      value: inr(h.arrProtected),
      sub: "recurring value that blended or mislabelled deals would have booked as one-time",
    },
    {
      label: "Clawback surprises",
      value: String(h.clawbackSurprises),
      sub: `target 0 · ${inr(h.exposureVisible)} exposure visible${h.minDaysToAct != null ? `, soonest in ${h.minDaysToAct} days` : ""}`,
      good: h.clawbackSurprises === 0,
    },
    {
      label: "Manual hours saved (est.)",
      value: `${h.hoursSaved.toFixed(1)} h`,
      sub: `AI cost so far $${h.aiCostUsd.toFixed(3)} for ${h.aiCalls} call(s)`,
    },
  ];

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Value</div>
        <h2 className="text-xl font-semibold tracking-tight">Pain points → value, measured live</h2>
        <p className="mt-0.5 text-sm text-zinc-600">
          Fix it at the source · AI does the manual work, humans approve · no surprises. Numbers come from this
          tool&apos;s data; whole portfolio, not filtered.
        </p>
      </div>

      <div className="grid gap-px border-b border-zinc-100 bg-zinc-100 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${t.good === false ? "text-red-700" : t.good ? "text-emerald-700" : ""}`}>
              {t.value}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="px-5 py-2 font-medium">Pain today</th>
              <th className="px-3 py-2 font-medium">What it costs</th>
              <th className="px-3 py-2 font-medium">What the tool does</th>
              <th className="px-5 py-2 font-medium">Live evidence</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.pain} className="border-t border-zinc-100 align-top">
                <td className="px-5 py-3 font-medium">
                  <Link href={r.href} className="hover:underline">
                    {r.pain}
                  </Link>
                </td>
                <td className="px-3 py-3 text-zinc-600">{r.cost}</td>
                <td className="px-3 py-3 text-zinc-700">{r.does}</td>
                <td className="px-5 py-3">
                  <ul className="space-y-0.5">
                    {r.evidence.map((e) => (
                      <li key={e.label} className="flex justify-between gap-3 text-xs">
                        <span className="text-zinc-500">{e.label}</span>
                        <span className="font-semibold tabular-nums">{e.value}</span>
                      </li>
                    ))}
                  </ul>
                  <div className={`mt-1 text-[11px] ${r.ok ? "text-emerald-700" : "text-amber-700"}`}>{r.ok ? "✓ under control" : "⚠ needs action (see Diagnose)"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] text-zinc-500">
        Hours saved is an estimate: {v.assumptions.dealCorrection} min per deal correction, {v.assumptions.briefDraft} min per
        brief, {v.assumptions.invoiceTracking} min per invoice tracked by spreadsheet, {v.assumptions.alertTriage} min per leak
        found by hand. Everything else is counted from data.
      </p>
    </section>
  );
}
