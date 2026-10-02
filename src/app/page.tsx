"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EngineBadge } from "@/components/EngineBadge";
import { PageHeader } from "@/components/PageHeader";
import type { Alert, Severity } from "@/lib/leaks";
import type { Engine } from "@/lib/modules";

type Stage = {
  key: string;
  label: string;
  href: string;
  engine: Engine;
  headline: string;
  detail: string;
  leak: { count: number; label: string };
  counts: Record<Severity, number>;
};

const SEV: Record<Severity, { dot: string; chip: string; label: string }> = {
  critical: { dot: "bg-red-600", chip: "bg-red-50 text-red-800 ring-red-200", label: "Critical" },
  warning: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 ring-amber-200", label: "Warning" },
  info: { dot: "bg-zinc-400", chip: "bg-zinc-50 text-zinc-700 ring-zinc-200", label: "Info" },
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function RevenueFlowPage() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [asOf, setAsOf] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/flow", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setStages(json.stages);
        setAlerts(json.alerts);
        setAsOf(json.asOf);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const critical = alerts.filter((a) => a.severity === "critical");
  const atStake = critical.reduce((s, a) => s + (a.impact ?? 0), 0);
  const shown = alerts.filter(
    (a) => (sevFilter === "all" || a.severity === sevFilter) && (!stageFilter || a.stage === stageFilter),
  );

  return (
    <>
      <PageHeader title="Revenue Flow" engine="rules">
        Every deal&apos;s path from rep&apos;s description to realised margin. Each stage shows what is
        falling through. The leak furthest left matters most: a bad deal record corrupts every stage after it.
      </PageHeader>

      {error && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>
      )}

      {stages && (
        <p className="mb-4 text-sm text-zinc-600">
          As of {asOf} ·{" "}
          <b className={critical.length ? "text-red-700" : "text-emerald-700"}>
            {critical.length} critical
          </b>
          {critical.length > 0 && <> ({inr(atStake)} at stake)</>} · {alerts.length - critical.length} other alerts. Click
          a stage to filter.
        </p>
      )}

      <ol className="grid gap-3 md:grid-cols-5">
        {(stages ?? Array.from({ length: 5 }, () => null)).map((s, i) => (
          <li key={s?.key ?? i} className="relative">
            {s ? (
              <button
                onClick={() => setStageFilter((f) => (f === s.key ? null : s.key))}
                className={`flex h-full w-full flex-col rounded-lg border bg-white p-4 text-left transition hover:shadow-sm ${
                  stageFilter === s.key ? "ring-2 ring-zinc-900" : ""
                } ${s.counts.critical ? "border-red-300" : s.counts.warning ? "border-amber-300" : "border-zinc-200"}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {i + 1}. {s.label}
                  </span>
                  <EngineBadge engine={s.engine} />
                </div>
                <div className="text-base font-semibold leading-snug">{s.headline}</div>
                <div className="mt-1 text-xs text-zinc-500">{s.detail}</div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                  {(["critical", "warning", "info"] as const).map((k) =>
                    s.counts[k] ? (
                      <span key={k} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${SEV[k].chip}`}>
                        {s.counts[k]} {k}
                      </span>
                    ) : null,
                  )}
                  {!s.counts.critical && !s.counts.warning && !s.counts.info && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800">✓ no leaks</span>
                  )}
                </div>
              </button>
            ) : (
              <div className="h-40 animate-pulse rounded-lg border border-zinc-200 bg-white" />
            )}
            {i < 4 && (
              <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-zinc-300 md:block">→</span>
            )}
          </li>
        ))}
      </ol>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-semibold">Exceptions inbox</h2>
          {(["all", "critical", "warning", "info"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSevFilter(k)}
              className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${
                sevFilter === k ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-300"
              }`}
            >
              {k === "all" ? `All (${alerts.length})` : `${SEV[k].label} (${alerts.filter((a) => a.severity === k).length})`}
            </button>
          ))}
          {stageFilter && (
            <button onClick={() => setStageFilter(null)} className="text-xs text-zinc-500 underline">
              clear stage filter ({stageFilter})
            </button>
          )}
        </div>
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV[a.severity].dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{a.title}</span>
                  <span className="truncate text-xs text-zinc-500">{a.subject}</span>
                </div>
                <p className="mt-0.5 text-sm text-zinc-600">{a.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                {a.impact != null && <span className="text-sm font-semibold tabular-nums">{inr(a.impact)}</span>}
                <Link href={a.href} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50">
                  {a.action} →
                </Link>
              </div>
            </li>
          ))}
          {stages && shown.length === 0 && <li className="p-4 text-sm text-zinc-500">Nothing here. ✓</li>}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          Rules-based and deterministic: every alert shows the numbers behind it. Humans work this list; everything
          else runs without them.
        </p>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          ["AI senses and drafts", "Claude reads messy deal text, splits blended revenue, drafts delivery briefs and billing milestones, and explains itself."],
          ["Code checks the money", "Deterministic validators re-check every amount, date and type against the source. Any failed check forces low confidence."],
          ["Humans commit", "Nothing reaches the deals or invoices tables without a named approver. Every AI run is kept for audit."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold">{t}</div>
            <p className="mt-1 text-sm text-zinc-600">{d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
