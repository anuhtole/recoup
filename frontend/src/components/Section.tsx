import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A flat section on the white canvas: a 14px title, optional meta on the right, a hairline beneath.
 * Sections are separated by space, not boxes.
 */
export function Section({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex min-h-8 items-center justify-between gap-4 border-b border-line pb-2">
        <h2 id={id} className="m-0 text-14 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {meta && <div className="flex-none text-13 text-dim">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

/** A quiet text link for section meta: "View all". */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-6 items-center font-medium text-mint-ink underline-offset-4 hover:underline">
      {children}
    </a>
  );
}
