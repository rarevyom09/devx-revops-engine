// Creates all tables by running supabase/schema.sql against DATABASE_URL.
// Usage: npm run db:setup   (destructive: drops and recreates every table)
import { readFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: url!, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(readFileSync("supabase/schema.sql", "utf8"));
  // Make PostgREST (the Supabase API) pick up the new tables immediately.
  await client.query("notify pgrst, 'reload schema'");
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  console.log("Tables:", rows.map((r) => r.table_name).join(", "));
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
