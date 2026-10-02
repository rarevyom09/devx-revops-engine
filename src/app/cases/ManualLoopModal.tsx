"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  COMMON_ASSUMPTIONS,
  MANUAL_LOOPS,
  formatElapsed,
  handsOnHours,
  type LoopActor,
  type LoopStep,
} from "@/lib/manual-loops";

const STEP_MS = 1200;

const ACTOR_STYLE: Record<LoopActor, string> = {
  Rep: "bg-zinc-100 text-zinc-700",
  Ops: "bg-zinc-100 text-zinc-700",
  Finance: "bg-zinc-100 text-zinc-700",
  Delivery: "bg-zinc-100 text-zinc-700",
  "Partner team": "bg-zinc-100 text-zinc-700",
  AI: "bg-violet-100 text-violet-800",
  Code: "bg-sky-100 text-sky-800",
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function ManualLoopModal({ caseKey, title, onClose }: { caseKey: string; title: string; onClose: () => void }) {
  const loop = MANUAL_LOOPS[caseKey];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const ticks = loop ? Math.max(loop.manual.length, loop.ai.length) : 0;
  const [tick, setTick] = useState(0); // number of shared timeline steps revealed
  const [playing, setPlaying] = useState(false);
  const done = tick >= ticks;

  // Focus management + background scroll lock.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  // Autoplay: one shared step every STEP_MS.
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      setTick((k) => Math.min(k + 1, ticks));
      if (tick + 1 >= ticks) setPlaying(false);
    }, STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, tick, ticks]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function play() {
    if (playing) return setPlaying(false);
    if (prefersReducedMotion()) {
      setTick(ticks);
      return;
    }
    if (done) setTick(0);
    setPlaying(true);
  }

  function skipToResults() {
    setPlaying(false);
    setTick(ticks);
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior, block: "start" }));
  }

  const manualShown = loop ? loop.manual.slice(0, Math.min(tick, loop.manual.length)) : [];
  const aiShown = loop ? loop.ai.slice(0, Math.min(tick, loop.ai.length)) : [];
  const clock = (steps: LoopStep[]) => (steps.length ? formatElapsed(steps[steps.length - 1].t) : "0 min");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/50 p-2 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-loop-title"
        aria-describedby="manual-loop-banner"
        onKeyDown={onKeyDown}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl sm:max-h-[calc(100dvh-3rem)]"
      >
        {/* Header */}
        <div className="border-b border-zinc-200 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-400">Manual loop vs AI-native loop</div>
              <h2 id="manual-loop-title" className="text-lg font-semibold">
                {title}
              </h2>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close"
              className="ml-auto rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50"
            >
              ✕
            </button>
          </div>
          <p id="manual-loop-banner" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Illustrative walkthrough — simulated timings based on stated assumptions. It does not read or change your pipeline data, and uses no AI calls.
          </p>
        </div>

        {!loop ? (
          <div className="p-5 text-sm text-zinc-600">No walkthrough written for this case yet.</div>
        ) : (
          <div className="overflow-y-auto p-4 sm:p-5">
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={play} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white">
                {playing ? "Pause" : done ? "Replay walkthrough" : tick > 0 ? "Resume" : "Play walkthrough"}
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setTick((k) => Math.max(0, k - 1));
                }}
                disabled={tick === 0}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setTick((k) => Math.min(ticks, k + 1));
                }}
                disabled={done}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                Next →
              </button>
              <button onClick={skipToResults} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
                Skip to results
              </button>
              <span className="text-xs tabular-nums text-zinc-500">
                Step {tick}/{ticks}
              </span>
              <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full bg-zinc-800 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${ticks ? (100 * tick) / ticks : 0}%` }} />
              </div>
            </div>

            <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-sm tabular-nums" aria-live="polite">
              <span className="font-medium">Manual: {clock(manualShown)} elapsed</span>
              <span className="text-zinc-400"> · </span>
              <span className="font-medium text-violet-800">AI-native: {clock(aiShown)}</span>
              <span className="ml-1 text-xs text-zinc-500">({loop.clockLabel})</span>
            </div>

            {/* Columns */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Column heading="Manual loop today (Devx, Zoho + spreadsheets)" tone="manual" steps={loop.manual} shown={manualShown.length} clock={clock(manualShown)} />
              <Column heading="AI-native loop (this tool)" tone="ai" steps={loop.ai} shown={aiShown.length} clock={clock(aiShown)} />
            </div>

            {/* Results */}
            <div ref={resultsRef} className="mt-6 scroll-mt-4">
              <h3 className="text-sm font-semibold">Results</h3>
              {!done ? (
                <p className="mt-1 text-xs text-zinc-500">Play the walkthrough to the end, or use Skip to results.</p>
              ) : (
                <Results loop={loop} />
              )}
            </div>

            {/* Assumptions */}
            <div className="mt-6 border-t border-zinc-200 pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Assumptions</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
                {[...loop.assumptions, ...COMMON_ASSUMPTIONS].map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Column({ heading, tone, steps, shown, clock }: { heading: string; tone: "manual" | "ai"; steps: LoopStep[]; shown: number; clock: string }) {
  const leaks = steps.slice(0, shown).filter((s) => (tone === "manual" ? s.leak : s.caught)).length;
  return (
    <section className={`rounded-lg border p-3 sm:p-4 ${tone === "ai" ? "border-violet-200 bg-violet-50/30" : "border-zinc-200"}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <span className="ml-auto text-xs tabular-nums text-zinc-500">
          {clock} · {leaks} {tone === "manual" ? (leaks === 1 ? "leak" : "leaks") : "caught"}
        </span>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => {
          const visible = i < shown;
          if (!visible)
            return (
              <li key={i} aria-hidden="true" className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-300">
                Step {i + 1}
              </li>
            );
          return (
            <li key={i} className="rounded-md border border-zinc-200 bg-white px-3 py-2 motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="tabular-nums text-zinc-400">{i + 1}.</span>
                <span className={`rounded px-1.5 py-0.5 font-medium ${ACTOR_STYLE[s.actor]}`}>{s.actor}</span>
                <span className="text-zinc-500">{s.tool}</span>
                <span className="ml-auto font-medium tabular-nums text-zinc-600">{s.when}</span>
              </div>
              <p className="mt-1 text-sm text-zinc-800">{s.what}</p>
              {s.leak && (
                <p className="mt-1.5 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">
                  <span className="font-semibold">Leak:</span> {s.leak}
                </p>
              )}
              {s.caught && (
                <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                  <span className="font-semibold">Caught:</span> {s.caught}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Results({ loop }: { loop: (typeof MANUAL_LOOPS)[string] }) {
  const mEnd = loop.manual[loop.manual.length - 1]?.t ?? 0;
  const aEnd = loop.ai[loop.ai.length - 1]?.t ?? 0;
  const tiles: { label: string; manual: string; ai: string; note?: string }[] = [
    {
      label: "Elapsed time",
      manual: formatElapsed(mEnd),
      ai: formatElapsed(aEnd),
      note: loop.showTimeSaved && mEnd > aEnd ? `Time saved: ~${formatElapsed(mEnd - aEnd)} (${loop.clockLabel})` : `Measured as ${loop.clockLabel}; the calendar, not the tool, sets the pace`,
    },
    { label: "Hands-on people-hours", manual: `~${handsOnHours(loop.manual)} h`, ai: `~${handsOnHours(loop.ai)} h` },
    { label: "Leaks", manual: `${loop.manual.filter((s) => s.leak).length} reached money or reports`, ai: `${loop.ai.filter((s) => s.caught).length} caught before they cost money` },
    ...loop.metrics,
  ];
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((m) => (
        <div key={m.label} className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{m.label}</div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-[11px] text-zinc-500">Manual</dt>
              <dd className="font-medium text-zinc-800">{m.manual}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-violet-700">AI-native</dt>
              <dd className="font-medium text-violet-900">{m.ai}</dd>
            </div>
          </dl>
          {m.note && <p className="mt-1 text-[11px] text-zinc-500">{m.note}</p>}
        </div>
      ))}
    </div>
  );
}
