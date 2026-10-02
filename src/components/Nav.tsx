"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MODULES, NAV_GROUPS } from "@/lib/modules";
import { EngineBadge } from "./EngineBadge";

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

const Brand = () => (
  <div className="text-sm font-semibold leading-tight">
    Devx Labs
    <div className="font-normal text-zinc-500">Revenue Ops Engine</div>
  </div>
);

export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop: fixed vertical sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-zinc-200 bg-white px-3 py-5 md:flex">
        <div className="mb-6 px-3">
          <Brand />
        </div>
        <nav className="flex-1 overflow-y-auto">
          <Links />
        </nav>
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
          <Links onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </>
  );
}
