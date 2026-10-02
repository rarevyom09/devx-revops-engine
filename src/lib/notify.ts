import "server-only";
import { db } from "./db";
import type { Severity } from "./leaks";
import type { Snapshot } from "./snapshot";

export type NotificationIn = {
  kind: "ai_analysed" | "ai_failed" | "brief_drafted" | "leak";
  severity?: Severity;
  title: string;
  body?: string;
  href?: string;
  owner_id?: string | null;
  dedupe_key?: string;
};

// Insert, silently skipping anything already notified (dedupe_key is unique).
export async function notify(items: NotificationIn[]) {
  if (!items.length) return;
  const rows = items.map((n) => ({ severity: "info", ...n }));
  await db().from("notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
}

// The "scheduled scan": every new critical/warning leak becomes one notification
// for the owner of the deal it concerns. Runs on poll and on the daily cron.
export async function scanLeaks(s: Snapshot) {
  const ownerOf = (a: Snapshot["alerts"][number]) => {
    if (a.ref.deal_id) return s.deals.find((d) => d.id === a.ref.deal_id)?.owner_id ?? null;
    if (a.ref.kind === "raw") return s.raw.find((r) => r.id === a.ref.id)?.owner_id ?? null;
    return null;
  };
  await notify(
    s.alerts
      .filter((a) => a.severity !== "info")
      .map((a) => ({
        kind: "leak" as const,
        severity: a.severity,
        title: a.title,
        body: `${a.subject} · ${a.detail}`,
        href: a.href,
        owner_id: ownerOf(a),
        dedupe_key: `leak:${a.id}`,
      })),
  );
}
