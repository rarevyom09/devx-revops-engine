"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Note = {
  id: string;
  kind: "ai_analysed" | "ai_failed" | "brief_drafted" | "leak" | "rep_question" | "rep_answered" | "draft_ready";
  severity: "critical" | "warning" | "info";
  title: string;
  body: string | null;
  href: string | null;
  owner_id: string | null;
  owner: { name: string } | null;
  read_at: string | null;
  created_at: string;
};
type Person = { id: string; name: string; role: string };

const DOT = { critical: "bg-red-600", warning: "bg-amber-500", info: "bg-violet-500" };
const KIND = {
  ai_analysed: "AI analysed",
  ai_failed: "AI paused",
  brief_drafted: "Brief drafted",
  leak: "Leak",
  rep_question: "Question for rep",
  rep_answered: "Rep answered",
  draft_ready: "Follow-up drafted",
};

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

const OWNER_KEY = "revops.viewAs";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [owner, setOwner] = useState("");

  const load = useCallback(async (who: string) => {
    const res = await fetch(`/api/notifications${who ? `?owner=${who}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const j = await res.json();
    setItems(j.items);
    setUnread(j.unread);
  }, []);

  useEffect(() => {
    let who = "";
    try {
      who = localStorage.getItem(OWNER_KEY) ?? "";
    } catch {}
    const id = setTimeout(() => setOwner(who));
    fetch("/api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setPeople(j.people));
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const tick = () => load(owner);
    const first = setTimeout(tick);
    const id = setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [owner, load]);

  async function mark(body: { action: "read"; id: string } | { action: "read_all" }) {
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    load(owner);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        aria-label={`Notifications, ${unread} unread`}
      >
        <span>🔔 Notifications</span>
        {unread > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
      </button>

      {open &&
        createPortal(
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Notifications">
          <button className="flex-1 bg-black/20" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4">
              <div>
                <h2 className="font-semibold">Notifications</h2>
                <p className="text-xs text-zinc-500">AI results and new leaks, pushed to the deal owner. In-app only.</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100">
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 text-xs">
              <label className="text-zinc-500">
                Viewing as{" "}
                <select
                  value={owner}
                  onChange={(e) => {
                    setItems([]);
                    setOwner(e.target.value);
                    try {
                      localStorage.setItem(OWNER_KEY, e.target.value);
                    } catch {}
                  }}
                  className="ml-1 rounded border border-zinc-300 px-1 py-0.5"
                >
                  <option value="">Ops lead (everyone)</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => mark({ action: "read_all" })} className="ml-auto text-zinc-500 underline hover:text-zinc-900">
                Mark all read
              </button>
            </div>
            <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto">
              {items.length === 0 && <li className="p-6 text-sm text-zinc-500">Nothing yet.</li>}
              {items.map((n) => (
                <li key={n.id} className={`p-4 ${n.read_at ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.severity]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-zinc-500">
                        <span className="font-medium uppercase tracking-wide">{KIND[n.kind]}</span>
                        <span>{n.owner?.name ? `→ ${n.owner.name}` : "→ ops"}</span>
                        <span>{ago(n.created_at)}</span>
                      </div>
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <p className="mt-0.5 text-xs text-zinc-600">{n.body}</p>}
                      <div className="mt-1.5 flex gap-3 text-xs">
                        {n.href && (
                          <Link
                            href={n.href}
                            onClick={() => {
                              setOpen(false);
                              if (!n.read_at) mark({ action: "read", id: n.id });
                            }}
                            className="font-medium text-zinc-900 underline"
                          >
                            Open →
                          </Link>
                        )}
                        {!n.read_at && (
                          <button onClick={() => mark({ action: "read", id: n.id })} className="text-zinc-500 underline">
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
