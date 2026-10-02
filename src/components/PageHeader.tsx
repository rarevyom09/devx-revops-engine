import type { ReactNode } from "react";
import type { Engine } from "@/lib/modules";
import { EngineBadge } from "./EngineBadge";

export function PageHeader({ title, engine, children }: { title: string; engine: Engine; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <EngineBadge engine={engine} />
      </div>
      {children && <p className="mt-1 max-w-3xl text-sm text-zinc-600">{children}</p>}
    </header>
  );
}
