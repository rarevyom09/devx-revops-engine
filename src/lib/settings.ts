import "server-only";
import { db } from "./db";

export type Settings = { auto_analyse: boolean; auto_brief: boolean; auto_drafts: boolean; ai_reserve: number };
const DEFAULTS: Settings = { auto_analyse: true, auto_brief: true, auto_drafts: true, ai_reserve: 5 };

export async function getSettings(): Promise<Settings> {
  const { data, error } = await db().from("app_settings").select("key,value");
  if (error || !data) return DEFAULTS;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const r of data) if (r.key in out) out[r.key] = r.value;
  return out as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const { error } = await db().from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
