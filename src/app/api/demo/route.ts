import { z } from "zod";
import { db, errorResponse, must } from "@/lib/db";
import { RESET_ORDER, SEED_ORDER } from "@/lib/demo-data";

const Body = z.object({ action: z.enum(["seed", "reset"]) });

async function reset() {
  for (const table of RESET_ORDER) {
    const pk = table === "rates" ? "location" : "id";
    // PostgREST refuses unfiltered deletes; this filter matches every row.
    must(await db().from(table).delete().not(pk, "is", null));
  }
}

async function seed() {
  for (const [table, rows, pk] of SEED_ORDER) {
    must(await db().from(table).upsert(rows as unknown as Record<string, unknown>[], { onConflict: pk }));
  }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "action must be seed | reset" }, { status: 400 });
  try {
    if (parsed.data.action === "reset") await reset();
    else await seed();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
