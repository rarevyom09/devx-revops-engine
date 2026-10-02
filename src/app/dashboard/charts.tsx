"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";

// Hand-rolled HTML/CSS charts (no chart dependency). Colours follow the
// dataviz reference palette: categorical slots for identity, status steps for state.
export const C = {
  s1: "#2a78d6",
  s2: "#eb6834",
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#b5b4ad",
  ord: ["#86b6ef", "#3987e5", "#184f95"],
  grid: "#e4e4e7",
};

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export const inrShort = (n: number) => `₹${compact.format(Math.round(n))}`;

// ---------- Tooltip ----------

export type TipRow = { label: string; value: string; color?: string };
export type TipContent = { title: string; rows: TipRow[]; hint?: string };
type TipState = (TipContent & { x: number; y: number }) | null;
const TipCtx = createContext<{ show: (x: number, y: number, c: TipContent) => void; hide: () => void }>({
  show: () => {},
  hide: () => {},
});

export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState>(null);
  const show = useCallback((x: number, y: number, c: TipContent) => setTip({ ...c, x, y }), []);
  const hide = useCallback(() => setTip(null), []);
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-64 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.max(8, Math.min(tip.x + 14, vw - 270)), top: tip.y + 14 }}
        >
          <div className="mb-1 font-medium text-zinc-700">{tip.title}</div>
          {tip.rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              {r.color && <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.color }} />}
              <span className="font-semibold tabular-nums text-zinc-900">{r.value}</span>
              <span className="text-zinc-500">{r.label}</span>
            </div>
          ))}
          {tip.hint && <div className="mt-1 text-[11px] text-zinc-400">{tip.hint}</div>}
        </div>
      )}
    </TipCtx.Provider>
  );
}

// Spread onto any mark: hover and keyboard focus show the same tooltip.
export function useTip() {
  const { show, hide } = useContext(TipCtx);
  return (c: TipContent) => ({
    onPointerMove: (e: PointerEvent) => show(e.clientX, e.clientY, c),
    onPointerLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      show(r.left + r.width / 2, r.bottom, c);
    },
    onBlur: hide,
  });
}

// ---------- Chrome ----------

export type LegendItem = { label: string; color: string; icon?: string; shape?: "rect" | "dot" | "line" };

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            className={i.shape === "dot" ? "h-2.5 w-2.5 rounded-full" : i.shape === "line" ? "h-0.5 w-3.5" : "h-2.5 w-2.5 rounded-sm"}
            style={{ background: i.color }}
          />
          {i.icon && <span className="text-zinc-500">{i.icon}</span>}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export type Table = { head: string[]; rows: (string | number)[][] };

export function Card({
  title,
  sub,
  legend,
  table,
  empty,
  className = "",
  children,
}: {
  title: string;
  sub?: string;
  legend?: LegendItem[];
  table?: Table;
  empty?: string | false;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-4 ${className}`}>
      <header className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
      </header>
      {empty ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-200 py-10 text-sm text-zinc-400">
          {empty}
        </div>
      ) : (
        <>
          {legend && legend.length > 1 && <div className="mb-3">{<Legend items={legend} />}</div>}
          <div className="min-w-0 flex-1">{children}</div>
          {table && table.rows.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-800">Table view</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left tabular-nums">
                  <thead className="text-zinc-500">
                    <tr>{table.head.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {table.rows.map((r, i) => (
                      <tr key={i}>{r.map((c, j) => <td key={j} className="py-1 pr-3 whitespace-nowrap">{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ---------- Horizontal stacked bars ----------

export type Seg = { key: string; label: string; value: number; color: string; display?: string };
export type BarRow = { key: string; label: string; segs: Seg[]; href?: string; tip: TipContent; end?: string };

// One row per category, segments stacked left to right with a 2px surface gap,
// 4px rounded data-end, square at the baseline. Value label at the tip.
export function HBars({ rows, max }: { rows: BarRow[]; max?: number }) {
  const tip = useTip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.segs.reduce((t, s) => t + s.value, 0)));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const total = r.segs.reduce((t, s) => t + s.value, 0);
        const visible = r.segs.filter((s) => s.value > 0);
        const bar = (
          <div className="flex items-center gap-2">
            <div className="flex h-5 min-w-0 flex-1 items-stretch">
              <div className="flex h-full gap-0.5" style={{ width: `${(total / top) * 100}%`, minWidth: total > 0 ? 3 : 0 }}>
                {visible.map((s, i) => (
                  <div
                    key={s.key}
                    className={`h-full transition-opacity group-hover:opacity-85 ${i === visible.length - 1 ? "rounded-r" : ""}`}
                    style={{ flexGrow: s.value, flexBasis: 0, background: s.color, minWidth: 2 }}
                  />
                ))}
              </div>
              <span className="ml-2 self-center whitespace-nowrap text-xs tabular-nums text-zinc-600">{r.end ?? inrShort(total)}</span>
            </div>
          </div>
        );
        return (
          <li key={r.key}>
            <div className="mb-1 truncate text-xs text-zinc-600" title={r.label}>{r.label}</div>
            {r.href ? (
              <Link href={r.href} className="group block rounded outline-offset-2" {...tip(r.tip)}>{bar}</Link>
            ) : (
              <div tabIndex={0} className="group rounded outline-offset-2" {...tip(r.tip)}>{bar}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Grouped columns with a y-axis ----------

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function Columns({
  groups,
  series,
}: {
  groups: { key: string; label: string; values: Record<string, number> }[];
  series: { key: string; label: string; color: string }[];
}) {
  const tip = useTip();
  const top = niceMax(Math.max(0, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const H = 180;
  return (
    <div className="flex gap-2">
      <div className="relative w-11 shrink-0 text-right text-[11px] tabular-nums text-zinc-400" style={{ height: H }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
            {inrShort(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative border-b border-zinc-300" style={{ height: H }}>
          {ticks.slice(1).map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-zinc-100" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex">
            {groups.map((g) => (
              <div
                key={g.key}
                tabIndex={0}
                className="group flex h-full flex-1 items-end justify-center gap-0.5 rounded-t hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none"
                {...tip({ title: g.label, rows: series.map((s) => ({ label: s.label, value: inrShort(g.values[s.key] ?? 0), color: s.color })) })}
              >
                {series.map((s) => (
                  <div
                    key={s.key}
                    className="w-full max-w-6 rounded-t"
                    style={{ height: `${((g.values[s.key] ?? 0) / top) * 100}%`, background: s.color, minHeight: g.values[s.key] ? 2 : 0 }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex">
          {groups.map((g) => (
            <div key={g.key} className="flex-1 pt-1 text-center text-[11px] text-zinc-500">{g.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Dot strip on a linear x-scale ----------

export type Dot = { key: string; label: string; x: number; color: string; tip: TipContent; href?: string; end?: string };
export type RefLine = { x: number; label: string; color?: string };

export function DotStrip({
  dots,
  domain,
  refs = [],
  band,
  ticks,
  fmt,
}: {
  dots: Dot[];
  domain: [number, number];
  refs?: RefLine[];
  band?: { from: number; to: number; label: string };
  ticks?: number[];
  fmt: (x: number) => string;
}) {
  const tip = useTip();
  const [lo, hi] = domain;
  const pos = (x: number) => `${((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="flex gap-3">
      <ul className="w-28 shrink-0 sm:w-44" style={{ paddingTop: refs.length * 16 }}>
        {dots.map((d) => (
          <li key={d.key} className="flex h-8 items-center truncate text-xs text-zinc-600" title={d.label}>
            <span className="truncate">{d.label}</span>
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1 pr-2">
        <div className="relative text-[11px] leading-4 text-zinc-500" style={{ height: refs.length * 16 }}>
          {refs.map((r, i) => (
            <span key={r.label} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(r.x), top: i * 16 }}>{r.label}</span>
          ))}
        </div>
        <div className="relative" style={{ height: dots.length * 32 }}>
          {band && (
            <div
              className="absolute inset-y-0 bg-amber-50"
              style={{ left: pos(band.from), width: `calc(${pos(band.to)} - ${pos(band.from)})` }}
            />
          )}
          {dots.map((d, i) => (
            <div key={d.key} className="absolute inset-x-0 border-t border-zinc-100" style={{ top: i * 32 + 16 }} />
          ))}
          {refs.map((r) => (
            <div key={r.label} className="absolute inset-y-0 w-px" style={{ left: pos(r.x), background: r.color ?? "#a1a1aa" }} />
          ))}
          {dots.map((d, i) => {
            const inner = (
              <span
                className="h-3 w-3 rounded-full ring-2 ring-white transition-transform group-hover:scale-125 group-focus:scale-125"
                style={{ background: d.color }}
              />
            );
            const cls = "group absolute flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400";
            const style = { left: pos(d.x), top: i * 32 + 4 };
            return d.href ? (
              <Link key={d.key} href={d.href} className={cls} style={style} {...tip(d.tip)} aria-label={d.label}>{inner}</Link>
            ) : (
              <span key={d.key} tabIndex={0} className={cls} style={style} {...tip(d.tip)} aria-label={d.label}>{inner}</span>
            );
          })}
        </div>
        <div className="relative mt-1 h-4 border-t border-zinc-300 text-[11px] tabular-nums text-zinc-400">
          {(ticks ?? [lo, (lo + hi) / 2, hi]).map((t) => (
            <span
              key={t}
              className={`absolute ${t <= lo ? "" : t >= hi ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: pos(t) }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
