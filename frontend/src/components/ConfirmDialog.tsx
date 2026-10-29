import { useEffect, useRef, type ReactNode } from "react";
import { COLORS, FONTS } from "../theme";
import { Button } from "./Button";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, isBusy, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(31, 29, 26, 0.32)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 20,
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: COLORS.surface,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          outline: "none",
          boxShadow: "0 20px 50px rgba(31, 29, 26, 0.18)",
        }}
      >
        <h2
          id="confirm-title"
          style={{ fontFamily: FONTS.serif, fontSize: 24, fontWeight: 500, margin: "0 0 10px" }}
        >
          {title}
        </h2>
        <div style={{ fontFamily: FONTS.serif, fontSize: 17, lineHeight: 1.45, color: COLORS.inkSoft }}>
          {children}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} isBusy={isBusy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
