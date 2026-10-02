"use client";
import { useEffect, useState } from "react";
import { AiCredits, CurrencyPicker, LockButton } from "@/components/Nav";
import { PageHeader } from "@/components/PageHeader";

type Settings = { auto_analyse: boolean; auto_brief: boolean; auto_drafts: boolean; ai_reserve: number };
type Toggle = "auto_analyse" | "auto_brief" | "auto_drafts";

const AUTOMATION: { key: Toggle; label: string; what: string }[] = [
  { key: "auto_analyse", label: "Analyse new deals", what: "When a deal is pasted, uploaded or loaded from a case, the integrity agent reads it straight away and the rep gets any questions. 1 AI call per deal (max 5 per upload)." },
  { key: "auto_brief", label: "Draft brief on approval", what: "When ops approves a split, the onboarding brief and billing milestones are drafted for each record. 1 AI call per record. A human still approves before invoices exist." },
  { key: "auto_drafts", label: "Draft follow-ups for leaks", what: "When a clawback risk, margin breach or renewal appears, a follow-up (payment chase, change request, renewal note) is drafted once and the owner is notified. Nothing is sent. Max 3 per scan." },
];

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (r) => (r.ok ? setS(await r.json()) : setError((await r.json()).error)))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(key: Toggle | "ai_reserve", value: boolean | number) {
    const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) });
    if (res.ok) setS(await res.json());
    else setError((await res.json()).error);
  }

  return (
    <>
      <PageHeader title="Settings" engine="data">
        Automation, AI budget, display currency and access. Changes apply to everyone using this demo.
      </PageHeader>
      {error && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Automation" note="AI runs by default; people review the results. Switch any of these off to fall back to manual buttons.">
          {!s ? (
            <div className="h-32 animate-pulse rounded bg-zinc-50" />
          ) : (
            <ul className="space-y-4">
              {AUTOMATION.map((a) => (
                <li key={a.key} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{a.label}</div>
                    <p className="mt-0.5 text-xs text-zinc-500">{a.what}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={s[a.key]}
                    aria-label={a.label}
                    onClick={() => save(a.key, !s[a.key])}
                    className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${s[a.key] ? "bg-violet-600" : "bg-zinc-300"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${s[a.key] ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </li>
              ))}
              <li className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-4">
                <div>
                  <div className="text-sm font-medium">AI reserve</div>
                  <p className="mt-0.5 text-xs text-zinc-500">Automation pauses when this many calls are left, so manual actions always have budget.</p>
                </div>
                <select value={s.ai_reserve} onChange={(e) => save("ai_reserve", Number(e.target.value))} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
                  {[0, 5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      {n} calls
                    </option>
                  ))}
                </select>
              </li>
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="AI budget" note="Hard cap on Claude API calls for the whole project, counted in the ai_calls ledger. When it runs out, AI actions fall back to manual entry; nothing is guessed.">
            <AiCredits />
          </Card>
          <Card title="Display currency" note="Display only. Data and inputs stay in INR.">
            <CurrencyPicker />
          </Card>
          <Card title="Access" note="The whole app sits behind one shared demo passcode. Locking signs this browser out.">
            <div className="w-40">
              <LockButton />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
