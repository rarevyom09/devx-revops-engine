import { aiUsage } from "@/lib/claude";
import { errorResponse } from "@/lib/db";

// Remaining Claude calls in the project budget (for the sidebar).
export async function GET() {
  try {
    const u = await aiUsage();
    return Response.json({ ...u, left: u.used == null ? null : Math.max(0, u.limit - u.used) });
  } catch (e) {
    return errorResponse(e);
  }
}
