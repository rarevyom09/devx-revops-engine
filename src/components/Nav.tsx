"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENCIES, FX, FX_AS_OF, setCurrency, useCurrency } from "@/lib/currency";
import { MODULES, NAV_GROUPS } from "@/lib/modules";
import { EngineBadge } from "./EngineBadge";
import { AutomationCard, NotificationBell } from "./Notifications";

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="space-y-5">
      {NAV_GROUPS.map((g) => (
        <div key={g}>
          <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{g}</div>
          <ul className="space-y-0.5">
            {MODULES.filter((m) => m.group === g).map((m) => {
              const active = m.href === "/" ? path === "/" : path.startsWith(m.href);
              return (
                <li key={m.href}>
                  <Link
                    href={m.href}
                    onClick={onNavigate}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm ${
                      active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    {m.label}
                    {m.engine === "ai" && <EngineBadge engine="ai" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Usage = { used: number | null; limit: number; left: number | null };

// Live view of the project-wide Claude call budget (ai_calls ledger).
function AiCredits() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/ai-usage", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setU(j))
        .catch(() => {});
    load();
    const id = setInterval(load, 20000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener("focus", load);
    };
  }, []);
  if (!u || u.left == null) return null;
  const pct = u.limit ? (u.left / u.limit) * 100 : 0;
  const tone = pct <= 10 ? "bg-red-500" : pct <= 30 ? "bg-amber-500" : "bg-violet-600";
  return (
    <div className="rounded-lg border border-zinc-200 p-3" title="Hard cap on Claude API calls for this project; further AI actions fall back to manual entry.">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-700">AI calls left</span>
        <span className="tabular-nums text-zinc-900">
          <b>{u.left}</b>
          <span className="text-zinc-400"> / {u.limit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CurrencyPicker() {
  const cur = useCurrency();
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="mb-1.5 text-xs font-medium text-zinc-700">Display currency</div>
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Display currency">
        {CURRENCIES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={cur === c}
            onClick={() => setCurrency(c)}
            className={`rounded-md py-1 text-xs ${cur === c ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
          >
            {c}
          </button>
        ))}
      </div>
      {cur !== "INR" && (
        <p data-no-fx className="mt-1.5 text-[10px] leading-snug text-zinc-500">
          Display only, at fixed demo FX (1 {cur} = ₹{FX[cur]}, {FX_AS_OF}). Data and inputs stay in INR.
        </p>
      )}
    </div>
  );
}

function LockButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/unlock", { method: "DELETE" });
        router.push("/unlock");
      }}
      className="w-full rounded-md px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
    >
      Lock app
    </button>
  );
}

const Brand = () => (
  <div className="text-sm font-semibold leading-tight">
    Devx Labs
    <div className="font-normal text-zinc-500">Revenue Ops Engine</div>
  </div>
);

export function Sidebar() {
  const [open, setOpen] = useState(false);
  if (usePathname() === "/unlock") return null;
  return (
    <>
      {/* Desktop: fixed vertical sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-zinc-200 bg-white px-3 py-5 md:flex">
        <div className="mb-4 px-3">
          <Brand />
        </div>
        <div className="mb-4">
          <NotificationBell />
        </div>
        <nav className="flex-1 overflow-y-auto">
          <Links />
        </nav>
        <div className="space-y-2 pt-3">
          <AutomationCard />
          <CurrencyPicker />
          <AiCredits />
          <LockButton />
        </div>
      </aside>

      {/* Mobile: top bar with a menu drawer */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 md:hidden">
        <Brand />
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={open}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav className="fixed inset-x-0 top-[57px] bottom-0 z-30 overflow-y-auto border-t border-zinc-200 bg-white px-3 py-4 md:hidden">
          <NotificationBell />
          <div className="mt-3" />
          <Links onNavigate={() => setOpen(false)} />
          <div className="mt-6 space-y-2">
            <AutomationCard />
            <CurrencyPicker />
            <AiCredits />
            <LockButton />
          </div>
        </nav>
      )}
    </>
  );
}
