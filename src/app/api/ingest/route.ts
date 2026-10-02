import { z } from "zod";
import { errorResponse } from "@/lib/db";
import { ingest } from "@/lib/ingest-server";
import { INGEST_TABLES } from "@/lib/ingest-spec";

const Body = z.object({
  table: z.enum(INGEST_TABLES),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
  dryRun: z.boolean().default(true),
  source: z.enum(["paste", "csv", "form"]).default("csv"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { table, rows, dryRun, source } = parsed.data;
  try {
    const out = await ingest(table, rows, { dryRun, source });
    return Response.json(out, { status: !dryRun && out.invalid > 0 ? 422 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
