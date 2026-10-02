import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export class NotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, then run supabase/schema.sql.",
    );
  }
}

// Service-role client. Server only: never import this from a client component.
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new NotConfiguredError();
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function errorResponse(e: unknown, status = 500) {
  if (e instanceof NotConfiguredError) {
    return Response.json({ error: e.message, notConfigured: true }, { status: 503 });
  }
  const message =
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);
  return Response.json({ error: message }, { status });
}

// Supabase returns { data, error }; turn error into a throw so routes stay linear.
export function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}
