import type { ReactNode } from "react";
import { eyebrow } from "../../theme";

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <h3 style={{ ...eyebrow, margin: 0, fontWeight: 400 }}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
