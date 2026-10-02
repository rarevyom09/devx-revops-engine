// Display currency. All data is stored and entered in INR; SGD/USD are a
// display conversion at fixed demo FX rates (see FAKED.md).
import { useSyncExternalStore } from "react";

export type Currency = "INR" | "SGD" | "USD";
export const CURRENCIES: Currency[] = ["INR", "SGD", "USD"];

// INR per 1 unit of the currency. Invented, fixed as of 2 Oct 2026.
export const FX: Record<Currency, number> = { INR: 1, SGD: 65, USD: 84 };
export const FX_AS_OF = "2 Oct 2026";

const SYMBOL: Record<Currency, string> = { INR: "₹", SGD: "S$", USD: "$" };
const UNIT: Record<string, number> = { k: 1e3, K: 1e3, L: 1e5, l: 1e5, Cr: 1e7, cr: 1e7 };

export function formatMoney(inr: number, cur: Currency, compact = false) {
  const v = inr / FX[cur];
  if (cur === "INR") return `₹${Math.round(v).toLocaleString("en-IN")}`;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (compact && a >= 1e6) return `${sign}${SYMBOL[cur]}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (compact && a >= 1e3) return `${sign}${SYMBOL[cur]}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${sign}${SYMBOL[cur]}${a.toLocaleString("en-US", { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
}

// Rewrites every "₹8,00,000" / "₹20L" / "₹1.2Cr" / "₹50k" in a string.
const MONEY = /₹\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(Cr|cr|L|l|k|K)\b)?/g;
export function convertText(text: string, cur: Currency) {
  if (cur === "INR") return text;
  return text.replace(MONEY, (_, num: string, unit?: string) => {
    const inr = parseFloat(num.replace(/,/g, "")) * (unit ? UNIT[unit] : 1);
    return formatMoney(inr, cur, !!unit);
  });
}

// Tiny persisted store so any client component can read/set the currency.
const KEY = "revops.currency";
const listeners = new Set<() => void>();
function read(): Currency {
  try {
    const v = localStorage.getItem(KEY);
    return v === "SGD" || v === "USD" ? v : "INR";
  } catch {
    return "INR";
  }
}
export function setCurrency(c: Currency) {
  try {
    localStorage.setItem(KEY, c);
  } catch {}
  listeners.forEach((l) => l());
}
export function useCurrency(): Currency {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "INR",
  );
}
