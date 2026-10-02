"use client";
import { useEffect } from "react";
import { convertText, useCurrency, type Currency } from "@/lib/currency";

// Converts every rendered ₹ amount to the chosen display currency. Keeps the
// original INR text per node so switching back (or React re-rendering) is exact.
// Mark an element data-no-fx to keep its ₹ text as is.
const original = new WeakMap<Text, string>();
const written = new WeakMap<Text, string>();
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"]);

const optedOut = (n: Node) => !!n.parentElement?.closest("[data-no-fx]");

function apply(node: Text, cur: Currency) {
  if (optedOut(node)) return;
  const value = node.nodeValue ?? "";
  // A value we didn't write is fresh INR text from React.
  if (written.get(node) !== value) original.set(node, value);
  const src = original.get(node) ?? value;
  if (!src.includes("₹") && cur !== "INR") return;
  const next = convertText(src, cur);
  if (next !== value) {
    written.set(node, next);
    node.nodeValue = next;
  } else {
    written.set(node, value);
  }
}

function walk(root: Node, cur: Currency) {
  if (root.nodeType === Node.TEXT_NODE) return apply(root as Text, cur);
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has((root as Element).tagName)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement && SKIP.has(n.parentElement.tagName)) || optedOut(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) apply(n as Text, cur);
}

export function CurrencyLayer() {
  const cur = useCurrency();
  useEffect(() => {
    walk(document.body, cur);
    if (cur === "INR") return; // originals restored; nothing to watch
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") apply(m.target as Text, cur);
        else m.addedNodes.forEach((n) => walk(n, cur));
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [cur]);
  return null;
}
