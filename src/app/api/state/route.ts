import { db, errorResponse, must } from "@/lib/db";
import { ALL_TABLES } from "@/lib/demo-data";

// Row counts per table + lookup lists for ingest dropdowns.
export async function GET() {
  try {
    const counts = Object.fromEntries(
      await Promise.all(
        ALL_TABLES.map(async (t) => {
          const { count, error } = await db().from(t).select("*", { count: "exact", head: true });
          if (error) throw new Error(`${t}: ${error.message}`);
          return [t, count ?? 0] as const;
        }),
      ),
    );
    const [people, deals, invoices] = await Promise.all([
      db().from("people").select("id,name,role,entity").order("name").then(must),
      db().from("deals").select("id,name").order("name").then(must),
      db().from("invoices").select("id,milestone,deals(name)").order("raised_on").then(must),
    ]);
    return Response.json({ counts, people, deals, invoices });
  } catch (e) {
    return errorResponse(e);
  }
}
