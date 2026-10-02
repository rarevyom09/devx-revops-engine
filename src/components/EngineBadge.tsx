import { ENGINE_LABEL, type Engine } from "@/lib/modules";

const STYLE: Record<Engine, string> = {
  ai: "bg-violet-100 text-violet-800 ring-violet-200",
  rules: "bg-sky-100 text-sky-800 ring-sky-200",
  stub: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  data: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

export function EngineBadge({ engine }: { engine: Engine }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${STYLE[engine]}`}>
      {ENGINE_LABEL[engine]}
    </span>
  );
}
