"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EngineBadge } from "@/components/EngineBadge";
import { PageHeader } from "@/components/PageHeader";

type CaseView = {
  key: string;
  title: string;
  area: string;
  engine: "ai" | "rules";
  aiCalls: string;
  why: string;
  expected: string[];
  loaded: boolean;
  progress: { done: number; total: number };
  steps: { title: string; how: string; href: string | null; done: boolean | null }[];
};

export default function CasesPage() {
  const [cases, setCases] = useState<CaseView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/cases", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setCases(json.cases);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    refresh();
    // Steps are completed on other tabs; re-check when the user comes back.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function load(c: CaseView) {
    if (c.loaded && !confirm(`Restart "${c.title}"? This deletes what you did in this case (approvals, briefs, invoices) and reloads it fresh.`)) return;
    setBusy(c.key);
    const res = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: c.key }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) setError(json.error);
    refresh();
  }

  return (
    <>
      <PageHeader title="Try cases" engine="data">
        Six runnable scenarios covering the assignment: deal hygiene, onboarding, guardrails, partners, realization
        and margin. Load a case, follow the steps in the real tabs, and the checklist ticks itself from live data.
        Each case uses its own clients, so it never touches the demo data.
      </PageHeader>

      {error && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {(cases ?? []).map((c, n) => {
          const complete = c.progress.total > 0 && c.progress.done === c.progress.total;
          return (
            <section key={c.key} className={`flex flex-col rounded-lg border bg-white p-5 ${complete ? "border-emerald-300" : "border-zinc-200"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-400">Case {n + 1}</span>
                <EngineBadge engine={c.engine} />
                <span className="text-xs text-zinc-500">{c.area}</span>
                <span className="ml-auto text-xs text-zinc-500">AI calls: {c.aiCalls}</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold">{c.title}</h2>
              <p className="mt-1 text-sm text-zinc-600">{c.why}</p>

              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => load(c)}
                  disabled={!!busy}
                  className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${c.loaded ? "border border-zinc-300 hover:bg-zinc-50" : "bg-zinc-900 text-white"}`}
                >
                  {busy === c.key ? "Loading…" : c.loaded ? "Restart case" : "Load case"}
                </button>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full ${complete ? "bg-emerald-500" : "bg-zinc-800"}`}
                    style={{ width: `${c.progress.total ? (100 * c.progress.done) / c.progress.total : 0}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-zinc-500">
                  {c.progress.done}/{c.progress.total}
                </span>
              </div>

              <ol className="mt-4 space-y-2">
                {c.steps.map((st, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        st.done === true
                          ? "bg-emerald-600 text-white"
                          : st.done === false
                            ? "border border-zinc-300 text-zinc-500"
                            : "border border-dashed border-zinc-300 text-zinc-400"
                      }`}
                      title={st.done === null ? "Look and see: not auto-checked" : undefined}
                    >
                      {st.done ? "✓" : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {st.href && c.loaded ? (
                          <Link href={st.href} className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
                            {st.title} →
                          </Link>
                        ) : (
                          st.title
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">{st.how}</div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-4 rounded-md bg-zinc-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">What you should see</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-700">
                  {c.expected.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
        {!cases && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-80 animate-pulse rounded-lg border border-zinc-200 bg-white" />)}
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Steps with a dashed circle are look-and-see; the rest tick automatically from the database. This page re-checks
        when you switch back to it.
      </p>
    </>
  );
}
