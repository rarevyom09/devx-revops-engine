import { timingSafeEqual } from "node:crypto";
import { PASS_COOKIE, passToken } from "@/lib/passcode";

const WEEK = 60 * 60 * 24 * 7;

// POST {passcode}: set the unlock cookie. DELETE: lock again.
export async function POST(req: Request) {
  const pass = process.env.DEMO_PASSCODE;
  if (!pass) return Response.json({ ok: true, disabled: true });
  const body = (await req.json().catch(() => null)) as { passcode?: unknown } | null;
  const given = typeof body?.passcode === "string" ? body.passcode : "";
  const a = Buffer.from(await passToken(given));
  const b = Buffer.from(await passToken(pass));
  if (!timingSafeEqual(a, b)) return Response.json({ error: "Wrong passcode" }, { status: 401 });

  const res = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append("set-cookie", `${PASS_COOKIE}=${b.toString()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK}${secure}`);
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${PASS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
