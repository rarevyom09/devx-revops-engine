export type Engine = "ai" | "rules" | "stub" | "data";

export type NavGroup = "Overview" | "Workflow" | "Monitor" | "About";

export const MODULES: { href: string; label: string; engine: Engine; step: number; group: NavGroup }[] = [
  { href: "/", label: "Revenue Flow", engine: "rules", step: 6, group: "Overview" },
  { href: "/dashboard", label: "Dashboard", engine: "rules", step: 6, group: "Overview" },
  { href: "/cases", label: "Try cases", engine: "data", step: 8, group: "Overview" },
  { href: "/ingest", label: "Ingest", engine: "data", step: 2, group: "Workflow" },
  { href: "/pipeline", label: "Deal Integrity", engine: "ai", step: 3, group: "Workflow" },
  { href: "/deals", label: "Deal Pipeline", engine: "ai", step: 3, group: "Workflow" },
  { href: "/onboarding", label: "Onboarding", engine: "ai", step: 4, group: "Workflow" },
  { href: "/clawback", label: "Clawback", engine: "rules", step: 5, group: "Monitor" },
  { href: "/margin", label: "Margin", engine: "rules", step: 7, group: "Monitor" },
  { href: "/honesty", label: "Honesty", engine: "data", step: 6, group: "About" },
];

export const NAV_GROUPS: NavGroup[] = ["Overview", "Workflow", "Monitor", "About"];

export const ENGINE_LABEL: Record<Engine, string> = {
  ai: "AI-native",
  rules: "Rules-based",
  stub: "Stubbed",
  data: "Data",
};
