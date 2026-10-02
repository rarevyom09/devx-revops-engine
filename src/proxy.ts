import { NextResponse, type NextRequest } from "next/server";
import { PASS_COOKIE, passToken } from "@/lib/passcode";

// Everything (pages and APIs) sits behind the demo passcode when DEMO_PASSCODE is set.
export async function proxy(req: NextRequest) {
  const pass = process.env.DEMO_PASSCODE;
  if (!pass) return NextResponse.next();
  if (req.cookies.get(PASS_COOKIE)?.value === (await passToken(pass))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "Locked: enter the demo passcode", locked: true }, { status: 401 });
  }
  const url = new URL("/unlock", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|unlock|api/unlock).*)"],
};
