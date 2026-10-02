"use client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_TODAY, isISODate, type ClawbackStatus } from "@/lib/clawback";
import {
  NO_FILTERS,
  alertsByStage,
  applyFilters,
  byQuarter,
  clawbackByOwner,
  dealMix,
  isFiltered,
  kpis,
  marginBand,
  type DashboardData,
  type Filters,
  type MarginBand,
} from "@/lib/dashboard";
import { formatDate, formatINR, formatPct } from "@/lib/format";
import { DEFAULT_TARGET_MARGIN_PCT, WARNING_MARGIN_PCT } from "@/lib/margin";
import { C, Card, Columns, DotStrip, HBars, Legend, TipProvider, inrShort, type BarRow, type LegendItem } from "./charts";

const PRESETS = [
  { label: "Today", date: DEMO_TODAY },
  { label: "15 Nov", date: "2026-11-15" },
  { label: "15 Dec", date: "2026-12-15" },
  { label: "1 Jan 2027", date: "2027-01-01" },
];

const STATUS: Record<ClawbackStatus, LegendItem & { order: number }> = {
  overdue_exposure: { label: "Missed deadline", color: C.critical, icon: "✕", order: 0 },
  at_risk: { label: "At risk (≤60d)", color: C.warning, icon: "!", order: 1 },
  partial: { label: "Partially paid", color: "#71717a", icon: "◐", order: 2 },
  open: { label: "Unpaid, time left", color: C.neutral, icon: "○", order: 3 },
  safe: { label: "Safe", color: C.good, icon: "✓", order: 4 },
};
const MARGIN: Record<MarginBand, LegendItem> = {
  warning: { label: "Below 30% floor", color: C.critical, icon: "✕" },
  below_target: { label: "Below target", color: C.warning, icon: "!" },
  on_target: { label: "On target", color: C.good, icon: "✓" },
};
const SEV = [
  { key: "critical", label: "Critical", color: C.critical, icon: "✕" },
  { key: "warning", label: "Warning", color: C.warning, icon: "!" },
  { key: "info", label: "Info", color: C.neutral, icon: "i" },
] as const;

type View = Filters & { asOf: string; target: number };
const DEFAULT_VIEW: View = { ...NO_FILTERS, asOf: DEMO_TODAY, target: Math.round(DEFAULT_TARGET_MARGIN_PCT * 100) };

function readUrl(): View {
  const q = new URLSearchParams(window.location.search);
  const asOf = q.get("asOf");
  const target = Number(q.get("target"));
  const entity = q.get("entity");
  const type = q.get("type");
  return {
    asOf: isISODate(asOf) ? asOf : DEMO_TODAY,
    target: target >= 30 && target <= 70 ? target : DEFAULT_VIEW.target,
    owner: q.get("owner") ?? "",
    entity: entity === "IN" || entity === "SG" ? entity : "",
    type: type === "one_time" || type === "recurring" ? type : "",
    practice: q.get("practice") ?? "",
  };
}

function writeUrl(v: View) {
  const q = new URLSearchParams();
  for (const [k, val] of Object.entries(v)) if (val !== "" && val !== DEFAULT_VIEW[k as keyof View]) q.set(k, String(val));
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

export default function DashboardPage() {
  const [view, setView] = useState<View | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read the shareable URL once on mount (no useSearchParams, so no Suspense boundary).
  useEffect(() => {
    const id = setTimeout(() => setView(readUrl()));
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (view) writeUrl(view);
  }, [view]);

  const asOf = view?.asOf;
  useEffect(() => {
    if (!asOf) return;
    let live = true;
    fetch(`/api/dashboard?asOf=${asOf}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        if (live) {
          setData(json);
          setError(null);
        }
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [asOf]);

  const set = (patch: Partial<View>) => {
    if (patch.asOf && patch.asOf !== view?.asOf) setLoading(true);
    setView((v) => ({ ...(v ?? DEFAULT_VIEW), ...patch }));
  };
  const slice = useMemo(() => (data && view ? applyFilters(data, view) : null), [data, view]);

  return (
    <TipProvider>
      <PageHeader title="Dashboard" engine="rules">
        The whole revenue flow at a glance. Move the as-of date to replay clawback deadlines; filters slice every chart.
      </PageHeader>

      <Controls view={view ?? DEFAULT_VIEW} data={data} set={set} />

      {error && <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}

      {!slice ? (
        <Skeleton />
      ) : (
        <div className={`transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          <Charts d={slice} target={(view?.target ?? DEFAULT_VIEW.target) / 100} filtered={isFiltered(view ?? DEFAULT_VIEW)} />
        </div>
      )}
    </TipProvider>
  );
}

// ---------- Controls ----------

const sel = "h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm";

function Controls({ view, data, set }: { view: View; data: DashboardData | null; set: (p: Partial<View>) => void }) {
  const owners = (data?.owners ?? []).filter((o) => !view.entity || o.entity === view.entity);
  return (
    <div className="z-20 -mx-4 mb-6 border-y border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur md:sticky md:top-0">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500" htmlFor="asof">As of</label>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              id="asof"
              type="date"
              value={view.asOf}
              onChange={(e) => isISODate(e.target.value) && set({ asOf: e.target.value })}
              className={sel}
            />
            {PRESETS.map((p) => (
              <button
                key={p.date}
                onClick={() => set({ asOf: p.date })}
                className={`h-8 rounded-md px-2.5 text-xs ring-1 ring-inset ${
                  view.asOf === p.date ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Owner">
          <select value={view.owner} onChange={(e) => set({ owner: e.target.value })} className={sel}>
            <option value="">All owners</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="Entity">
          <select value={view.entity} onChange={(e) => set({ entity: e.target.value as View["entity"], owner: "" })} className={sel}>
            <option value="">IN + SG</option>
            <option value="IN">India</option>
            <option value="SG">Singapore</option>
          </select>
        </Field>
        <Field label="Deal type">
          <select value={view.type} onChange={(e) => set({ type: e.target.value as View["type"] })} className={sel}>
            <option value="">All types</option>
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </select>
        </Field>
        <Field label="Practice">
          <select value={view.practice} onChange={(e) => set({ practice: e.target.value })} className={sel}>
            <option value="">All practices</option>
            {(data?.practices ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label={`Target margin ${view.target}%`}>
          <input
            type="range"
            min={30}
            max={70}
            step={1}
            value={view.target}
            onChange={(e) => set({ target: Number(e.target.value) })}
            className="h-8 w-36 accent-zinc-900"
            aria-label="Target margin percent"
          />
        </Field>
        <button
          onClick={() => set({ ...NO_FILTERS, target: DEFAULT_VIEW.target })}
          disabled={!isFiltered(view) && view.target === DEFAULT_VIEW.target}
          className="h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-lg border border-zinc-200 bg-white" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-lg border border-zinc-200 bg-white" />)}
      </div>
    </div>
  );
}

// ---------- Charts ----------

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: "bad" | "good"; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 truncate text-xl font-semibold ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}

const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const short = (s: string) => s.split(" - ")[0];

function Charts({ d, target, filtered }: { d: DashboardData; target: number; filtered: boolean }) {
  const k = kpis(d);
  const mix = dealMix(d);
  const quarters = byQuarter(d);
  const owners = clawbackByOwner(d);
  const stages = alertsByStage(d);
  const raised = d.invoices.filter((i) => i.raised && i.status && i.days_left != null).sort((a, b) => a.days_left! - b.days_left!);
  const tracked = d.margins.filter((m) => m.margin_pct != null);
  const noHours = d.margins.length - tracked.length;
  const noDeals = d.deals.length === 0 ? (filtered ? "No deals match these filters" : "No approved deals yet") : false;

  const funnel: BarRow[] = [
    { key: "c", label: "Contracted", v: k.contracted, color: C.ord[0] },
    { key: "i", label: "Invoiced (raised to date)", v: k.invoiced, color: C.ord[1] },
    { key: "p", label: "Collected", v: k.collected, color: C.ord[2] },
  ].map((r) => ({
    key: r.key,
    label: r.label,
    segs: [{ key: r.key, label: r.label, value: r.v, color: r.color }],
    end: `${inrShort(r.v)} · ${pctOf(r.v, k.contracted)}`,
    tip: { title: r.label, rows: [{ label: `${pctOf(r.v, k.contracted)} of contracted`, value: formatINR(r.v) }] },
  }));

  const mixRows: BarRow[] = [
    {
      key: "value",
      label: "Contract value",
      segs: [
        { key: "o", label: "One-time", value: mix.one_time.value, color: C.s1 },
        { key: "r", label: "Recurring", value: mix.recurring.value, color: C.s2 },
      ],
      tip: {
        title: "Contract value",
        rows: [
          { label: `one-time (${mix.one_time.count} deals)`, value: formatINR(mix.one_time.value), color: C.s1 },
          { label: `recurring (${mix.recurring.count} deals)`, value: formatINR(mix.recurring.value), color: C.s2 },
        ],
      },
    },
    {
      key: "arr",
      label: "Recurring ARR (monthly × 12)",
      segs: [{ key: "r", label: "ARR", value: mix.recurring.arr, color: C.s2 }],
      tip: { title: "Recurring ARR", rows: [{ label: "monthly × 12", value: formatINR(mix.recurring.arr), color: C.s2 }] },
    },
  ];

  const ownerRows: BarRow[] = owners.map((o) => ({
    key: o.owner,
    label: o.owner,
    href: "/clawback",
    segs: [
      { key: "r", label: "Realised", value: o.realised, color: C.critical },
      { key: "p", label: "Projected", value: o.projected, color: C.serious },
    ],
    tip: {
      title: o.owner,
      rows: [
        { label: "realised clawback", value: formatINR(o.realised), color: C.critical },
        { label: "projected exposure", value: formatINR(o.projected), color: C.serious },
        { label: "variable pay at stake", value: formatINR(o.at_stake) },
      ],
      hint: "Click for the Clawback tab",
    },
  }));
  const anyClawback = owners.some((o) => o.realised + o.projected > 0);

  const lo = 30 * Math.floor(Math.min(-30, ...raised.map((i) => i.days_left! - 10)) / 30);
  const hi = 30 * Math.ceil(Math.max(120, ...raised.map((i) => i.days_left! + 10)) / 30);

  const mLo = Math.floor(10 * Math.min(0, ...tracked.map((m) => m.margin_pct! - 0.05))) / 10;
  const mHi = Math.ceil(10 * Math.max(0.6, target + 0.1, ...tracked.map((m) => m.margin_pct! + 0.05))) / 10;

  const maxHours = Math.max(1, ...tracked.map((m) => m.hours.IN + m.hours.SG));
  const hourRows: BarRow[] = tracked.map((m) => {
    const total = m.hours.IN + m.hours.SG;
    return {
      key: m.deal_id,
      label: m.name,
      href: "/deals",
      end: `${total} h · ${Math.round((m.hours.SG / total) * 100)}% SG`,
      segs: [
        { key: "IN", label: "India", value: m.hours.IN, color: C.s1 },
        { key: "SG", label: "Singapore", value: m.hours.SG, color: C.s2 },
      ],
      tip: {
        title: m.name,
        rows: [
          { label: "India hours", value: `${m.hours.IN} h`, color: C.s1 },
          { label: "Singapore hours", value: `${m.hours.SG} h`, color: C.s2 },
          { label: "blended rate / h", value: formatINR(m.blended_rate) },
          { label: "delivery cost", value: formatINR(m.cost) },
        ],
        hint: "Click for the deal board",
      },
    };
  });

  const alertMax = Math.max(1, ...stages.map((s) => s.critical + s.warning + s.info));
  const alertRows: BarRow[] = stages.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.critical + s.warning + s.info ? s.href : "/",
    end: `${s.critical + s.warning + s.info}`,
    segs: SEV.map((v) => ({ key: v.key, label: v.label, value: s[v.key], color: v.color })),
    tip: {
      title: `${s.label} stage`,
      rows: SEV.map((v) => ({ label: v.label.toLowerCase(), value: String(s[v.key]), color: v.color })),
      hint: `Click for ${s.href}`,
    },
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Contracted value" value={formatINR(k.contracted)} sub={`${k.deals} deal${k.deals === 1 ? "" : "s"}`} />
        <Tile label="Invoiced to date" value={formatINR(k.invoiced)} sub={`${pctOf(k.invoiced, k.contracted)} of contracted`} />
        <Tile label="Collected to date" value={formatINR(k.collected)} sub={`${pctOf(k.collected, k.invoiced)} of invoiced`} />
        <Tile label="Realised clawback" value={formatINR(k.realised)} tone={k.realised > 0 ? "bad" : undefined} sub="deadline missed" />
        <Tile label="Projected exposure" value={formatINR(k.projected)} tone={k.projected > 0 ? "bad" : undefined} sub="if nothing more is paid" />
        <Tile label="Critical alerts" value={String(k.critical)} tone={k.critical ? "bad" : "good"} sub={`${d.alerts.length} alerts in total`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Revenue flow"
          sub="Contracted → invoiced → collected, as of the selected date"
          empty={noDeals}
          table={{ head: ["Stage", "₹", "% of contracted"], rows: funnel.map((r) => [r.label, formatINR(r.segs[0].value), pctOf(r.segs[0].value, k.contracted)]) }}
        >
          <HBars rows={funnel} max={Math.max(k.contracted, k.invoiced, k.collected, 1)} />
        </Card>

        <Card
          title="One-time vs recurring"
          sub="Contract value split by deal type; ARR for recurring deals"
          empty={noDeals}
          legend={[{ label: "One-time", color: C.s1 }, { label: "Recurring", color: C.s2 }]}
          table={{
            head: ["Type", "Deals", "Contract value", "ARR"],
            rows: [
              ["One-time", mix.one_time.count, formatINR(mix.one_time.value), "—"],
              ["Recurring", mix.recurring.count, formatINR(mix.recurring.value), formatINR(mix.recurring.arr)],
            ],
          }}
        >
          <HBars rows={mixRows} />
        </Card>

        <Card
          title="Invoiced vs collected by quarter"
          sub="Calendar quarters: invoices by raise date, cash by payment date"
          empty={quarters.length === 0 && "Nothing invoiced yet"}
          legend={[{ label: "Invoiced", color: C.s1 }, { label: "Collected", color: C.s2 }]}
          table={{ head: ["Quarter", "Invoiced", "Collected"], rows: quarters.map((q) => [q.label, formatINR(q.invoiced), formatINR(q.collected)]) }}
        >
          <Columns
            groups={quarters.map((q) => ({ key: q.key, label: q.label, values: { invoiced: q.invoiced, collected: q.collected } }))}
            series={[{ key: "invoiced", label: "invoiced", color: C.s1 }, { key: "collected", label: "collected", color: C.s2 }]}
          />
        </Card>

        <Card
          title="Clawback by owner"
          sub="Variable pay already clawed back vs exposure if nothing more is paid"
          empty={owners.length === 0 ? "No invoices raised yet" : !anyClawback && "No clawback exposure ✓"}
          legend={[{ label: "Realised", color: C.critical, icon: "✕" }, { label: "Projected", color: C.serious, icon: "!" }]}
          table={{ head: ["Owner", "Realised", "Projected", "At stake"], rows: owners.map((o) => [o.owner, formatINR(o.realised), formatINR(o.projected), formatINR(o.at_stake)]) }}
        >
          <HBars rows={ownerRows} />
        </Card>

        <Card
          title="Realization deadlines"
          sub="Each raised invoice by days left to its deadline (end of the following quarter)"
          className="lg:col-span-2"
          empty={raised.length === 0 && "No invoices raised by this date"}
          table={{
            head: ["Invoice", "Owner", "Amount", "Paid", "Deadline", "Days left", "Status", "Exposure"],
            rows: raised.map((i) => [
              `${i.deal} · ${i.milestone}`, i.owner ?? "—", formatINR(i.amount), formatINR(i.paid_to_date), formatDate(i.deadline),
              i.days_left!, STATUS[i.status!].label, formatINR(i.realised || i.projected),
            ]),
          }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Legend items={Object.values(STATUS).sort((a, b) => a.order - b.order).map((s) => ({ ...s, shape: "dot" as const }))} />
            <span className="flex items-center gap-1.5 text-xs text-zinc-500"><span className="h-2.5 w-4 rounded-sm bg-amber-50 ring-1 ring-amber-200" />60-day risk window</span>
          </div>
          <DotStrip
            domain={[lo, hi]}
            band={{ from: 0, to: 60, label: "At-risk window" }}
            refs={[{ x: 0, label: "as of", color: "#18181b" }]}
            ticks={[lo, 0, 60, hi]}
            fmt={(x) => `${Math.round(x)}d`}
            dots={raised.map((i) => ({
              key: i.id,
              label: `${i.milestone} · ${short(i.deal)}`,
              x: i.days_left!,
              color: STATUS[i.status!].color,
              href: "/clawback",
              tip: {
                title: `${i.deal} · ${i.milestone}`,
                rows: [
                  { label: STATUS[i.status!].label, value: `${STATUS[i.status!].icon} ${i.days_left}d`, color: STATUS[i.status!].color },
                  { label: "amount", value: formatINR(i.amount) },
                  { label: "paid to date", value: formatINR(i.paid_to_date) },
                  { label: `deadline`, value: formatDate(i.deadline) },
                  { label: i.realised ? "clawed back" : "exposure", value: formatINR(i.realised || i.projected) },
                ],
                hint: "Click for the Clawback tab",
              },
            }))}
          />
        </Card>

        <Card
          title="Margin by deal"
          sub={`Against the ${formatPct(WARNING_MARGIN_PCT, 0)} floor and ${formatPct(target, 0)} target${noHours ? ` · ${noHours} deal${noHours === 1 ? "" : "s"} with no hours logged` : ""}`}
          empty={tracked.length === 0 && (noDeals || "No hours logged yet")}
          table={{
            head: ["Deal", "Price", "Cost", "Margin", "Status"],
            rows: tracked.map((m) => [m.name, formatINR(m.price), formatINR(m.cost), formatPct(m.margin_pct), MARGIN[marginBand(m.margin_pct!, target)].label]),
          }}
        >
          <div className="mb-3"><Legend items={Object.values(MARGIN).map((s) => ({ ...s, shape: "dot" as const }))} /></div>
          <DotStrip
            domain={[mLo, mHi]}
            refs={[
              { x: WARNING_MARGIN_PCT, label: "30% floor", color: C.critical },
              { x: target, label: `${Math.round(target * 100)}% target`, color: "#18181b" },
            ]}
            ticks={[mLo, mHi]}
            fmt={(x) => formatPct(x, 0)}
            dots={tracked.map((m) => {
              const b = MARGIN[marginBand(m.margin_pct!, target)];
              return {
                key: m.deal_id,
                label: short(m.name),
                x: m.margin_pct!,
                color: b.color,
                href: "/deals",
                tip: {
                  title: m.name,
                  rows: [
                    { label: b.label, value: `${b.icon} ${formatPct(m.margin_pct)}`, color: b.color },
                    { label: "price", value: formatINR(m.price) },
                    { label: "delivery cost", value: formatINR(m.cost) },
                    { label: "vs target", value: `${((m.margin_pct! - target) * 100).toFixed(1)} pts` },
                  ],
                  hint: "Click for the deal board",
                },
              };
            })}
          />
        </Card>

        <Card
          title="Delivery hours: India vs Singapore"
          sub={"Singapore hours cost more per hour, so the mix drives margin"}
          empty={tracked.length === 0 && (noDeals || "No hours logged yet")}
          legend={[{ label: "India", color: C.s1 }, { label: "Singapore", color: C.s2 }]}
          table={{
            head: ["Deal", "IN h", "SG h", "Blended ₹/h", "Cost"],
            rows: tracked.map((m) => [m.name, m.hours.IN, m.hours.SG, formatINR(m.blended_rate), formatINR(m.cost)]),
          }}
        >
          <HBars rows={hourRows} max={maxHours} />
        </Card>

        <Card
          title="Alerts by stage"
          sub="Leak-engine alerts by severity; click a stage to act on it"
          className="lg:col-span-2"
          empty={d.alerts.length === 0 && "No alerts ✓"}
          legend={SEV.map((s) => ({ label: s.label, color: s.color, icon: s.icon }))}
          table={{ head: ["Stage", "Critical", "Warning", "Info"], rows: stages.map((s) => [s.label, s.critical, s.warning, s.info]) }}
        >
          <HBars rows={alertRows} max={alertMax} />
        </Card>
      </div>
    </div>
  );
}
