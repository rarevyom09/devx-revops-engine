"use client";
import { useState } from "react";

export default function UnlockPage() {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: pass }),
    });
    setBusy(false);
    if (!res.ok) return setError("That passcode didn't work.");
    const next = new URLSearchParams(window.location.search).get("next");
    // Only same-site paths, never an external redirect.
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold">Devx Labs</div>
        <div className="text-sm text-zinc-500">Revenue Ops Engine</div>
        <h1 className="mt-5 text-lg font-semibold">Enter the demo passcode</h1>
        <p className="mt-1 text-sm text-zinc-600">
          This demo writes to a shared database and spends a capped AI budget, so it&apos;s locked.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="mt-4 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          placeholder="Passcode"
          aria-label="Passcode"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy || !pass} className="mt-4 w-full rounded-md bg-zinc-900 py-2 text-sm text-white disabled:opacity-40">
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
