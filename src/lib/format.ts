const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

// ₹8,00,000 (Indian digit grouping, whole rupees).
export function formatINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return inr.format(Math.round(n));
}

// "28 Jun 2026". Accepts ISO date strings; treated as UTC so dates never shift by timezone.
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}
