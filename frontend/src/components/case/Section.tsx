import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-14 font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
