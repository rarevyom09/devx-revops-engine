import { errorResponse } from "@/lib/db";
import { buildBoard, loadSnapshot } from "@/lib/snapshot";

// GET /api/deals: every deal at its current stage, with per-stage detail.
export async function GET() {
  try {
    return Response.json(buildBoard(await loadSnapshot()));
  } catch (e) {
    return errorResponse(e);
  }
}
