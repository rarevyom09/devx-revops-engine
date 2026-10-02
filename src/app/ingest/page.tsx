"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { PageHeader } from "@/components/PageHeader";
import {
  INGEST_TABLES,
  QUICK_FORM_TABLES,
  TABLE_SPECS,
  csvTemplate,
  type IngestTable,
  type RowResult,
} from "@/lib/ingest-spec";

type AppState = {
  counts: Record<string, number>;
  people: { id: string; name: string; role: string; entity: string }[];
  deals: { id: string; name: string }[];
  invoices: { id: string; milestone: string; deals: { name: string } | null }[];
};

type IngestResponse = { committed: number; invalid: number; results: RowResult[]; error?: string };

async function postJSON<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function IngestPage() {
  const [state, setState] = useState<AppState | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [mode, setMode] = useState<"paste" | "csv" | "form">("paste");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setConfigError(json.error ?? "Could not load state");
      setState(null);
    } else {
      setConfigError(null);
      setState(json);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    refresh();
  }, [refresh]);

  async function demo(action: "seed" | "reset") {
    if (action === "reset" && !confirm("Delete ALL rows in every table?")) return;
    setBusy(action);
    const out = await postJSON<{ ok: boolean }>("/api/demo", { action });
    setBusy(null);
    setFlash(out.error ? `Error: ${out.error}` : action === "seed" ? "Demo data loaded." : "All tables emptied.");
    refresh();
  }

  const onCommitted = (msg: string) => {
    setFlash(msg);
    refresh();
  };

  return (
    <>
      <PageHeader title="Ingest" engine="data">
        Get data in without touching SQL. Deals land in <code>raw_deals</code> as <b>pending</b>; only
        human approval in Deal Integrity creates real deal records. Pasted text is stored as untrusted
        data and is never treated as instructions.
      </PageHeader>

      {configError && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Database not reachable.</b> {configError}
        </div>
      )}

      {flash && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
          <span>{flash}</span>
          <button className="text-zinc-400 hover:text-zinc-700" onClick={() => setFlash(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex border-b border-zinc-200">
            {(
              [
                ["paste", "Paste deal text"],
                ["csv", "CSV upload"],
                ["form", "Quick form"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2.5 text-sm ${
                  mode === m ? "border-b-2 border-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p-5">
            {mode === "paste" && <PasteMode state={state} onCommitted={onCommitted} />}
            {mode === "csv" && <CsvMode onCommitted={onCommitted} />}
            {mode === "form" && <QuickForm state={state} onCommitted={onCommitted} />}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Demo data</h2>
            <div className="flex gap-2">
              <button
                disabled={!!busy || !!configError}
                onClick={() => demo("seed")}
                className="flex-1 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {busy === "seed" ? "Loading…" : "Load demo data"}
              </button>
              <button
                disabled={!!busy || !!configError}
                onClick={() => demo("reset")}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                {busy === "reset" ? "…" : "Reset"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Idempotent: re-loading restores demo rows without duplicating them.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Row counts</h2>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(state?.counts ?? {}).map(([t, n]) => (
                  <tr key={t} className="border-t border-zinc-100 first:border-0">
                    <td className="py-1 font-mono text-xs text-zinc-600">{t}</td>
                    <td className="py-1 text-right tabular-nums">{n}</td>
                  </tr>
                ))}
                {!state && (
                  <tr>
                    <td className="text-xs text-zinc-400">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </aside>
      </div>
    </>
  );
}

function PasteMode({ state, onCommitted }: { state: AppState | null; onCommitted: (m: string) => void }) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const owners = state?.people.filter((p) => p.role === "consulting_owner") ?? [];

  async function submit() {
    setBusy(true);
    const out = await postJSON<IngestResponse>("/api/ingest", {
      table: "raw_deals",
      source: "paste",
      dryRun: false,
      rows: [{ raw_text: text, owner }],
    });
    setBusy(false);
    if (out.error) return setErrors([out.error]);
    const errs = out.results?.flatMap((r) => r.errors) ?? [];
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setText("");
    onCommitted("Deal added to the pending queue. Analyse it in Deal Integrity.");
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Deal text</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Acme Retail: website rebuild ₹8L, delivery by 30 Nov, plus ₹50k/month support for 12 months starting Dec. Co-sold with AWS."
          className="mt-1 w-full rounded-md border border-zinc-300 p-3 text-sm focus:border-zinc-900 focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">Consulting owner</span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="mt-1 block w-56 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="">— unassigned —</option>
            {owners.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name} ({p.entity})
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !text.trim()}
          onClick={submit}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Add to pending queue"}
        </button>
      </div>
      <Errors errors={errors} />
      <p className="text-xs text-zinc-500">
        Nothing is analysed or turned into a deal here. The text is saved verbatim as a pending raw deal.
      </p>
    </div>
  );
}

function CsvMode({ onCommitted }: { onCommitted: (m: string) => void }) {
  const [table, setTable] = useState<IngestTable>("raw_deals");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [check, setCheck] = useState<IngestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = TABLE_SPECS[table];

  function reset(t: IngestTable) {
    setTable(t);
    setRows([]);
    setFileName(null);
    setCheck(null);
    setParseErrors([]);
  }

  function download() {
    const blob = new Blob([csvTemplate(table)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${table}_template.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onFile(file: File) {
    setFileName(file.name);
    setCheck(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: async (res) => {
        const missing = spec.columns
          .filter((c) => c.required && !res.meta.fields?.includes(c.key))
          .map((c) => `missing required column "${c.key}"`);
        const errs = [...missing, ...res.errors.slice(0, 5).map((e) => `row ${(e.row ?? 0) + 1}: ${e.message}`)];
        setParseErrors(errs);
        setRows(res.data);
        if (missing.length || res.data.length === 0) return;
        setBusy(true);
        const out = await postJSON<IngestResponse>("/api/ingest", {
          table,
          rows: res.data,
          dryRun: true,
          source: "csv",
        });
        setBusy(false);
        if (out.error) setParseErrors([out.error]);
        else setCheck(out);
      },
    });
  }

  async function commit() {
    setBusy(true);
    const out = await postJSON<IngestResponse>("/api/ingest", { table, rows, dryRun: false, source: "csv" });
    setBusy(false);
    if (out.error || out.invalid) {
      setCheck(out.results ? out : check);
      setParseErrors([out.error ?? "Validation failed, nothing committed."]);
      return;
    }
    onCommitted(`Committed ${out.committed} row(s) to ${table}.`);
    reset(table);
  }

  const errorsByRow = useMemo(
    () => new Map(check?.results.filter((r) => !r.ok).map((r) => [r.index, r.errors]) ?? []),
    [check],
  );
  const laterErrors = check?.results.filter((r) => !r.ok && r.index >= 10) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">Target table</span>
          <select
            value={table}
            onChange={(e) => reset(e.target.value as IngestTable)}
            className="mt-1 block w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          >
            {INGEST_TABLES.map((t) => (
              <option key={t} value={t}>
                {TABLE_SPECS[t].label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={download} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
          Download template
        </button>
        <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
          {fileName ?? "Choose CSV…"}
          <input
            key={table}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      </div>

      <p className="text-sm text-zinc-600">{spec.description}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1 font-medium">Column</th>
            <th className="py-1 font-medium">Required</th>
            <th className="py-1 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {spec.columns.map((c) => (
            <tr key={c.key} className="border-t border-zinc-100">
              <td className="py-1 font-mono">{c.key}</td>
              <td className="py-1">{c.required ? "yes" : "—"}</td>
              <td className="py-1 text-zinc-600">{c.hint}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Errors errors={parseErrors} />

      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <b>{rows.length}</b> row(s) parsed
              {check && (
                <>
                  {" · "}
                  <span className={check.invalid ? "text-red-700" : "text-emerald-700"}>
                    {check.invalid ? `${check.invalid} invalid` : "all valid"}
                  </span>
                </>
              )}
              {busy && <span className="text-zinc-500"> · checking…</span>}
            </div>
            <button
              disabled={busy || !check || check.invalid > 0}
              onClick={commit}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Commit {rows.length} row(s)
            </button>
          </div>
          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  {spec.columns.map((c) => (
                    <th key={c.key} className="px-2 py-1.5 font-mono font-medium">
                      {c.key}
                    </th>
                  ))}
                  <th className="px-2 py-1.5">Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => {
                  const errs = errorsByRow.get(i);
                  return (
                    <tr key={i} className={`border-t border-zinc-100 ${errs ? "bg-red-50" : ""}`}>
                      <td className="px-2 py-1.5 text-zinc-400">{i + 1}</td>
                      {spec.columns.map((c) => (
                        <td key={c.key} className="max-w-xs truncate px-2 py-1.5" title={r[c.key]}>
                          {r[c.key]}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        {errs ? <span className="text-red-700">{errs.join("; ")}</span> : check ? "✓" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 10 && <p className="text-xs text-zinc-500">Showing first 10 of {rows.length}.</p>}
          {laterErrors.length > 0 && (
            <Errors errors={laterErrors.map((r) => `row ${r.index + 1}: ${r.errors.join("; ")}`)} />
          )}
          <p className="text-xs text-zinc-500">
            Nothing is written until you click Commit. Commit is all-or-nothing.
          </p>
        </div>
      )}
    </div>
  );
}

function QuickForm({ state, onCommitted }: { state: AppState | null; onCommitted: (m: string) => void }) {
  const [table, setTable] = useState<IngestTable>("invoices");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const spec = TABLE_SPECS[table];
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const milestones =
    state?.invoices.filter((i) => i.deals?.name === values.deal_name).map((i) => i.milestone) ?? [];

  async function submit() {
    setBusy(true);
    const out = await postJSON<IngestResponse>("/api/ingest", {
      table,
      rows: [values],
      dryRun: false,
      source: "form",
    });
    setBusy(false);
    if (out.error && !out.results) return setErrors([out.error]);
    const errs = out.results?.flatMap((r) => r.errors) ?? [];
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setValues({});
    onCommitted(`Added 1 row to ${table}.`);
  }

  function field(c: (typeof spec.columns)[number]) {
    const cls = "mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
    const v = values[c.key] ?? "";
    let options: readonly string[] | undefined = c.options;
    if (c.key === "deal_name") options = state?.deals.map((d) => d.name) ?? [];
    if (c.key === "milestone" && table === "payments") options = milestones;
    if (c.key === "owner") options = state?.people.map((p) => p.name) ?? [];
    if (options) {
      return (
        <select className={cls} value={v} onChange={(e) => set(c.key, e.target.value)}>
          <option value="">{c.required ? "— select —" : "— default —"}</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    }
    const isDate = c.hint === "YYYY-MM-DD";
    return (
      <input
        type={isDate ? "date" : "text"}
        className={cls}
        value={v}
        placeholder={c.hint}
        onChange={(e) => set(c.key, e.target.value)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Record type</span>
        <select
          value={table}
          onChange={(e) => {
            setTable(e.target.value as IngestTable);
            setValues({});
            setErrors([]);
          }}
          className="mt-1 block w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
        >
          {QUICK_FORM_TABLES.map((t) => (
            <option key={t} value={t}>
              {TABLE_SPECS[t].label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-zinc-600">{spec.description}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.columns.map((c) => (
          <label key={c.key} className="block">
            <span className="text-sm font-medium">
              {c.key}
              {c.required && <span className="text-red-600"> *</span>}
            </span>
            {field(c)}
          </label>
        ))}
      </div>
      <button
        disabled={busy}
        onClick={submit}
        className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Add row"}
      </button>
      <Errors errors={errors} />
    </div>
  );
}

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}
