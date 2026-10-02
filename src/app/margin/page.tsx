"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  DEFAULT_TARGET_MARGIN_PCT,
  WARNING_MARGIN_PCT,
  computeMargin,
  type DealInput,
  type Hours,
  type MarginResult,
  type MarginStatus,
  type Rates,
} from "@/lib/margin";
import { formatINR, formatPct } from "@/lib/format";

type MarginResponse = { rates: Rates; missingRates: string[]; deals: (DealInput & MarginResult)[] };

const STATUS: Record<MarginStatus, { label: string; cls: string }> = {
  no_hours: { label: "No hours logged", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  warning: { label: `Below ${WARNING_MARGIN_PCT * 100}%`, cls: "bg-red-50 text-red-800 ring-red-200" },
  below_target: { label: "Below target", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  on_target: { label: "On target", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

const ZERO: Hours = { IN: 0, SG: 0 };

export default function MarginPage() {
  const [data, setData] = useState<MarginResponse | null>(null);
  const [error, setError] = useState<{ message: string; notConfigured?: boolean } | null>(null);
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET_MARGIN_PCT * 100);
  const [extra, setExtra] = useState<Record<string, Hours>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/margin", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setError({ message: json.error ?? "Could not load margin data", notConfigured: json.notConfigured });
        else setData(json);
      })
      .catch((e) => !cancelled && setError({ message: String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const target = targetPct / 100;
  const setHours = (id: string, loc: keyof Hours, v: string) =>
    setExtra((x) => ({ ...x, [id]: { ...(x[id] ?? ZERO), [loc]: Math.max(0, Number(v) || 0) } }));
  const anySimulated = Object.values(extra).some((h) => h.IN || h.SG);

  return (
    <>
      <PageHeader title="Margin" engine="rules">
        Quoted price vs delivery cost from logged India (offshore) and Singapore (onsite) hours. Scope creep shows up
        as live margin erosion against the target.
      </PageHeader>

      {error && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>{error.notConfigured ? "Database not reachable." : "Error."}</b> {error.message}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
          <p>
            <b>Formula:</b> blended rate = (IN h × IN rate + SG h × SG rate) ÷ total h; cost = total h × blended rate;
            margin = price − cost − pass-through; margin % = margin ÷ price. Erosion = target % − actual %.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-zinc-500">
            <li>
              Rates: IN {formatINR(data?.rates.IN)}/h, SG {formatINR(data?.rates.SG)}/h (invented, INR).
              {!!data?.missingRates.length && (
                <span className="text-red-700"> Missing rate for {data.missingRates.join(", ")}: costs understated.</span>
              )}
            </li>
            <li>
              <b>Pass-through costs are stubbed at ₹0</b>: there is no table for them yet.
            </li>
            <li>No planned-hours data exists, so the plan is a target margin % (editable).</li>
            <li>Recurring deals: price assumed = monthly amount × term months (to confirm against Zoho).</li>
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <label className="block">
            <span className="text-sm font-medium">Target margin (plan)</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={targetPct}
                onChange={(e) => setTargetPct(Number(e.target.value) || 0)}
                className="w-20 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-zinc-500">%</span>
            </div>
          </label>
          <p className="mt-2 text-xs text-zinc-500">Warning line is fixed at {WARNING_MARGIN_PCT * 100}%.</p>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Deals</h2>
          {anySimulated && (
            <div className="flex items-center gap-3 text-xs">
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-800 ring-1 ring-violet-200 ring-inset">
                Simulation active: what-if hours are not saved
              </span>
              <button onClick={() => setExtra({})} className="text-zinc-500 underline hover:text-zinc-800">
                Clear what-ifs
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Deal</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">IN h</th>
                <th className="px-3 py-2 text-right font-medium">SG h</th>
                <th className="px-3 py-2 text-right font-medium">Blended rate</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
                <th className="px-3 py-2 text-right font-medium">Margin %</th>
                <th className="px-3 py-2 text-right font-medium">Erosion</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">What-if: extra hours</th>
              </tr>
            </thead>
            <tbody>
              {data?.deals.map((d) => {
                const add = extra[d.id] ?? ZERO;
                const simulated = !!(add.IN || add.SG);
                const m = computeMargin(d, { IN: d.hours.IN + add.IN, SG: d.hours.SG + add.SG }, data.rates, {
                  targetPct: target,
                });
                const base = computeMargin(d, d.hours, data.rates, { targetPct: target });
                return (
                  <tr key={d.id} className={`border-t border-zinc-100 align-top ${simulated ? "bg-violet-50/40" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-zinc-500">
                        {d.owner_name ?? "Unassigned"} · {d.deal_type === "recurring" ? "recurring" : "one-time"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatINR(m.price)}
                      {d.deal_type === "recurring" && (
                        <div className="text-[11px] whitespace-nowrap text-amber-700">assumed: {m.price_basis}</div>
                      )}
                    </td>
                    <HoursCell logged={d.hours.IN} added={add.IN} />
                    <HoursCell logged={d.hours.SG} added={add.SG} />
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m.blended_rate == null ? "—" : `${formatINR(m.blended_rate)}/h`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m.status === "no_hours" ? "—" : formatINR(m.cost)}
                      {m.status !== "no_hours" && (
                        <div className="text-[11px] whitespace-nowrap text-zinc-500">
                          {m.hours.IN}×{formatINR(data.rates.IN)} + {m.hours.SG}×{formatINR(data.rates.SG)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.margin == null ? "—" : formatINR(m.margin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={m.status === "warning" ? "font-medium text-red-700" : ""}>
                        {m.margin_pct == null ? "—" : formatPct(m.margin_pct)}
                      </span>
                      {simulated && base.margin_pct != null && (
                        <div className="text-[11px] text-zinc-500">was {formatPct(base.margin_pct)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m.erosion_pct == null ? "—" : m.erosion_pct > 0 ? `${(m.erosion_pct * 100).toFixed(1)} pts` : "none"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[m.status].cls}`}
                      >
                        {STATUS[m.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        {(["IN", "SG"] as const).map((loc) => (
                          <label key={loc} className="flex items-center gap-1 text-xs text-zinc-500">
                            +{loc}
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={add[loc] || ""}
                              placeholder="0"
                              onChange={(e) => setHours(d.id, loc, e.target.value)}
                              className="w-16 rounded-md border border-zinc-300 px-1.5 py-1 text-sm text-zinc-900"
                            />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data && data.deals.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-zinc-400">
                    No approved deals yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          What-if hours are a client-side simulation of scope creep. Nothing is written to timesheets.
        </p>
      </section>
    </>
  );
}

function HoursCell({ logged, added }: { logged: number; added: number }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {logged + added}
      {added > 0 && <div className="text-[11px] text-violet-700">{logged} + {added} what-if</div>}
    </td>
  );
}
