import { MODULES } from "@/lib/modules";
import { PageHeader } from "./PageHeader";

export function NotBuilt({ href, blurb }: { href: string; blurb: string }) {
  const m = MODULES.find((x) => x.href === href)!;
  return (
    <>
      <PageHeader title={m.label} engine={m.engine}>{blurb}</PageHeader>
      <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500">
        Not built yet (build step {m.step}).
      </div>
    </>
  );
}
