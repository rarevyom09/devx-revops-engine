import "server-only";
import { db, must } from "./db";
import { type IngestTable, type IngestRow, type RowResult, validateRowShape } from "./ingest-spec";

type Lookups = {
  people: Map<string, string>; // lower(name) -> id
  deals: Map<string, { id: string; owner_id: string | null }>; // lower(name) -> deal
  invoices: Map<string, string>; // `${deal_id}|${lower(milestone)}` -> id
};

const key = (s: string) => s.trim().toLowerCase();

async function loadLookups(): Promise<Lookups> {
  const [people, deals, invoices] = await Promise.all([
    db().from("people").select("id,name").then(must),
    db().from("deals").select("id,name,owner_id").then(must),
    db().from("invoices").select("id,deal_id,milestone").then(must),
  ]);
  return {
    people: new Map(people.map((p) => [key(p.name), p.id])),
    deals: new Map(deals.map((d) => [key(d.name), { id: d.id, owner_id: d.owner_id }])),
    invoices: new Map(invoices.map((i) => [`${i.deal_id}|${key(i.milestone)}`, i.id])),
  };
}

type Resolved = { record: Record<string, unknown> } | { error: string };

function resolve(
  table: IngestTable,
  row: IngestRow<IngestTable>,
  L: Lookups,
  source: string,
): Resolved {
  const person = (name?: string) => (name ? L.people.get(key(name)) : undefined);
  const deal = (name: string) => L.deals.get(key(name));

  switch (table) {
    case "raw_deals": {
      const r = row as IngestRow<"raw_deals">;
      const owner_id = person(r.owner);
      if (r.owner && !owner_id) return { error: `owner "${r.owner}" not found in people` };
      return { record: { raw_text: r.raw_text, owner_id: owner_id ?? null, source, status: "pending" } };
    }
    case "invoices": {
      const r = row as IngestRow<"invoices">;
      const d = deal(r.deal_name);
      if (!d) return { error: `deal "${r.deal_name}" not found (must be an approved deal)` };
      const owner_id = r.owner ? person(r.owner) : d.owner_id;
      if (r.owner && !owner_id) return { error: `owner "${r.owner}" not found in people` };
      return {
        record: {
          deal_id: d.id,
          milestone: r.milestone,
          amount: r.amount,
          raised_on: r.raised_on,
          owner_id: owner_id ?? null,
          variable_pay_at_stake: r.variable_pay_at_stake ?? Math.round(r.amount * 0.05),
        },
      };
    }
    case "payments": {
      const r = row as IngestRow<"payments">;
      const d = deal(r.deal_name);
      if (!d) return { error: `deal "${r.deal_name}" not found` };
      const invoice_id = L.invoices.get(`${d.id}|${key(r.milestone)}`);
      if (!invoice_id) return { error: `no invoice "${r.milestone}" on deal "${r.deal_name}"` };
      return { record: { invoice_id, amount: r.amount, paid_on: r.paid_on } };
    }
    case "timesheets": {
      const r = row as IngestRow<"timesheets">;
      const d = deal(r.deal_name);
      if (!d) return { error: `deal "${r.deal_name}" not found` };
      return { record: { deal_id: d.id, location: r.location, hours: r.hours, logged_on: r.logged_on } };
    }
    case "people": {
      const r = row as IngestRow<"people">;
      if (person(r.name)) return { error: `person "${r.name}" already exists` };
      return { record: { ...r, variable_pay_target: r.variable_pay_target ?? null } };
    }
    case "rates": {
      const r = row as IngestRow<"rates">;
      return { record: { ...r, currency: r.currency ?? "INR" } };
    }
  }
}

export async function ingest(
  table: IngestTable,
  rows: Record<string, unknown>[],
  opts: { dryRun: boolean; source: string },
) {
  const L = await loadLookups();
  const results: RowResult[] = [];
  const records: Record<string, unknown>[] = [];

  rows.forEach((row, index) => {
    const shape = validateRowShape(table, row);
    if (!shape.ok) {
      results.push({ index, ok: false, errors: shape.errors });
      return;
    }
    const r = resolve(table, shape.data, L, opts.source);
    if ("error" in r) {
      results.push({ index, ok: false, errors: [r.error] });
      return;
    }
    results.push({ index, ok: true, errors: [] });
    records.push(r.record);
  });

  const invalid = results.filter((r) => !r.ok).length;
  if (opts.dryRun || invalid > 0) {
    return { committed: 0, invalid, results, ids: [] as string[] };
  }

  // Single statement => all-or-nothing.
  if (table === "rates") {
    must(await db().from(table).upsert(records, { onConflict: "location" }));
    return { committed: records.length, invalid: 0, results, ids: [] as string[] };
  }
  const inserted = must(await db().from(table).insert(records).select("id")) as { id: string }[];
  return { committed: records.length, invalid: 0, results, ids: inserted.map((r) => r.id) };
}
