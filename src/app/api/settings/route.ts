import { z } from "zod";
import { errorResponse } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/settings";

export async function GET() {
  try {
    return Response.json(await getSettings());
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.union([
  z.object({ key: z.enum(["auto_analyse", "auto_brief", "auto_drafts"]), value: z.boolean() }),
  z.object({ key: z.literal("ai_reserve"), value: z.number().int().min(0).max(50) }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid setting" }, { status: 400 });
  try {
    await setSetting(parsed.data.key, parsed.data.value as never);
    return Response.json(await getSettings());
  } catch (e) {
    return errorResponse(e);
  }
}
