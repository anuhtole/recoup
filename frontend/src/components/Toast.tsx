import { useEffect } from "react";
import { COLORS, FONTS } from "../theme";

export interface ToastMessage {
  id: number;
  text: string;
  tone: "info" | "error";
}

const VISIBLE_MS = 4_500;

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDone, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "calc(100vw - 32px)",
        padding: "11px 16px",
        borderRadius: 10,
        fontFamily: FONTS.mono,
        fontSize: 13,
        color: toast.tone === "error" ? "#FFFFFF" : COLORS.ink,
        background: toast.tone === "error" ? "#8C3B2E" : COLORS.surface,
        border: `1px solid ${toast.tone === "error" ? "#8C3B2E" : COLORS.borderStrong}`,
        boxShadow: "0 10px 30px rgba(31, 29, 26, 0.12)",
        zIndex: 30,
      }}
    >
      {toast.text}
    </div>
  );
}
