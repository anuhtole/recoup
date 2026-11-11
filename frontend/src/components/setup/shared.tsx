import type { ReactNode } from "react";

/** One setup step: a numbered panel with its state. Plain on purpose; the final look comes later. */
export function Step({ n, title, done, hint, children }: { n: number; title: string; done: boolean; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-glass p-5" aria-labelledby={`setup-${n}`}>
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={`setup-${n}`} className="text-16 font-semibold">
          {n}. {title}
        </h2>
        <span className={done ? "text-14 text-money-ink" : "text-14 text-dim"}>{done ? "Done" : "To do"}</span>
      </header>
      {!done && <p className="mb-4 text-14 text-dim">{hint}</p>}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-14">
      <span className="text-dim">{label}</span>
      {children}
    </label>
  );
}

export const INPUT = "h-10 rounded-row bg-field px-3 text-14 text-ink outline-none focus:ring-2 focus:ring-accent";

export function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 text-14 text-amber">
      {message}
    </p>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** A file's bytes as base64, for JSON bodies (the API takes no multipart). */
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}
