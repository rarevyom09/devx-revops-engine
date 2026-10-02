// Run a SQL file against the linked Supabase project via the Management API.
// Usage: npm run db:sql supabase/003_rep_answers.sql
import { readFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1];
const file = process.argv[2];

async function main() {
  if (!token || !ref || !file) {
    console.error("Need SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL and a SQL file path");
    process.exit(1);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: readFileSync(file, "utf8") }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${body}`);
    process.exit(1);
  }
  console.log(`Ran ${file} on ${ref}: ${body.slice(0, 300)}`);
}

main();
