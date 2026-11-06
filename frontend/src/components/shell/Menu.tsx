import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ITEM = '[role="menuitem"]:not([aria-disabled="true"])';

interface MenuProps {
  /** Accessible name of the menu, e.g. "Demo". */
  label: string;
  /** What the trigger button shows. */
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  panelClassName?: string;
  /** The menu's rows; `close` shuts the menu and gives focus back to the trigger. */
  children: (close: () => void) => ReactNode;
}

/**
 * A dropdown menu: a button that opens a small floating list. Arrow keys, Home and End move between
 * items; Escape and Tab close it; a click outside closes it. Focus goes back to the trigger on close.
 */
export function Menu({ label, trigger, triggerClassName, triggerTitle, align = "end", panelClassName, children }: MenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef<"first" | "last">("first");
  const id = useId();

  const close = useCallback((restore = true) => {
    setIsOpen(false);
    if (restore) button.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const items = panel.current?.querySelectorAll<HTMLElement>(ITEM);
    const target = focusFirst.current === "last" ? items?.[items.length - 1] : items?.[0];
    (target ?? panel.current)?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [isOpen, close]);

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    // Every key the menu handles stops here, so page shortcuts (j / k, Escape) don't also fire.
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close(false);
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) event.preventDefault();
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusFirst.current = event.key === "ArrowUp" ? "last" : "first";
      setIsOpen(true);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        onClick={() => {
          focusFirst.current = "first";
          setIsOpen((open) => !open);
        }}
        onKeyDown={onTriggerKey}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panel}
            id={id}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onPanelKey}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(
              "pop absolute top-full z-40 mt-1.5 min-w-56 py-1 text-14 text-ink outline-none",
              align === "end" ? "right-0" : "left-0",
              panelClassName,
            )}
          >
            {children(() => close())}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  hint,
  icon,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Right-aligned detail: a keyboard hint or a check. */
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onSelect()}
      className={cn(
        "mx-1 flex h-9 w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-sm px-2.5 text-left text-14 outline-none transition-colors",
        // Hover and focus share one quiet fill, as in any native menu; no outline ring inside a menu.
        disabled ? "cursor-not-allowed text-dim" : "hover:bg-ground focus:bg-ground",
      )}
    >
      {icon && <span className="grid size-4 flex-none place-items-center text-dim">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="flex-none text-12 text-dim">{hint}</span>}
    </button>
  );
}

/** A read-only row: a heading, the signed-in name, the as-of date. Not focusable. */
export function MenuNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="none" className={cn("px-3.5 py-2 text-13 text-dim", className)}>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}
