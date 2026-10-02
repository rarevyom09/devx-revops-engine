import { errorResponse } from "@/lib/db";
import type { Alert } from "@/lib/leaks";
import { flowStages, loadSnapshot } from "@/lib/snapshot";

// One pass over every stage: deal -> booking -> invoice -> realization -> margin.
// Each stage reports a headline and its leak (what is falling through).
export async function GET() {
  try {
    const snap = await loadSnapshot();
    // Home page contract is unchanged: alerts without the deal-board `ref`.
    const alerts = snap.alerts.map((a) => {
      const out: Partial<Alert> = { ...a };
      delete out.ref;
      return out;
    });
    return Response.json({ asOf: snap.asOf, alerts, stages: flowStages(snap) });
  } catch (e) {
    return errorResponse(e);
  }
}
