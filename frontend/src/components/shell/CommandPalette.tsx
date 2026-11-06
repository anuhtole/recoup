import { motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Finding } from "../../api";
import { formatMoney } from "../../format";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { referenceOf, rowsFor, tabOf } from "../../queue";
import { LEAK_LABEL } from "../../theme";
import { vendorName } from "@/lib/vendors";
import { cn } from "@/lib/utils";
import { VendorLogo } from "../VendorLogo";

export interface Command {
  id: string;
  group: "Pages" | "Actions";
  label: string;
  icon: ReactNode;
  /** Extra words that should find it ("sync", "csv"). */
  keywords?: string;
  hint?: ReactNode;
  run: () => void;
}

interface Item {
  id: string;
  group: "Claims" | "Pages" | "Actions";
  label: string;
  detail?: string;
  icon: ReactNode;
  hint?: ReactNode;
  haystack: string[];
  run: () => void;
}

interface Props {
  findings: Finding[];
  commands: Command[];
  onOpenCase: (id: number) => void;
  onClose: () => void;
}

/**
 * How well `query` matches `text`: a prefix beats a word start beats a substring beats the letters in
 * order. -1 is no match.
 */
function score(query: string, text: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(query)) return 100 - Math.min(t.length - query.length, 40) / 4;
  if (t.split(/[\s/·(),-]+/).some((word) => word.startsWith(query))) return 80;
  if (t.includes(query)) return 60;
  let at = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return -1;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return Math.max(1, 30 - gaps);
}

const bare = (text: string) => text.replace(/[$,]/g, "");

const GROUP_ORDER: Item["group"][] = ["Claims", "Pages", "Actions"];

/**
 * ⌘K: one search over cases (vendor, reference, amount), pages and actions. Arrow keys move, Enter
 * runs, Escape closes. Focus stays in the palette while it is open and returns to where it was after.
 */
export function CommandPalette({ findings, commands, onOpenCase, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const isNarrow = useIsNarrow();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const cases = useMemo<Item[]>(() => {
    // To do first, by deadline, then everything else: the cases you are most likely looking for.
    const todo = rowsFor(findings, "todo");
    const rest = findings.filter((f) => tabOf(f) !== "todo");
    return [...todo, ...rest].map((f) => {
      const name = vendorName(f.merchant);
      const ref = referenceOf(f.reason);
      const amount = formatMoney(f.amount_minor, f.currency);
      return {
        id: `case-${f.id}`,
        group: "Claims",
        label: name,
        detail: [LEAK_LABEL[f.leak_type], ref].filter(Boolean).join(" · "),
        icon: <VendorLogo name={f.merchant} size={20} />,
        hint: <span className="figure text-13 text-ink">{amount}</span>,
        haystack: [name, ref ?? "", amount, bare(amount), LEAK_LABEL[f.leak_type]],
        run: () => onOpenCase(f.id),
      };
    });
  }, [findings, onOpenCase]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const others: Item[] = commands.map((c) => ({
      id: c.id,
      group: c.group,
      label: c.label,
      icon: c.icon,
      hint: c.hint,
      haystack: [c.label, c.keywords ?? ""],
      run: c.run,
    }));
    if (!q) return [...cases.slice(0, 5), ...others];
    const ranked = [...cases, ...others]
      .map((item) => ({ item, s: Math.max(...item.haystack.map((h) => score(bare(q), bare(h))), ...item.haystack.map((h) => score(q, h))) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s);
    const shownCases = ranked.filter((r) => r.item.group === "Claims").slice(0, 8);
    const shownOthers = ranked.filter((r) => r.item.group !== "Claims");
    // Groups keep a fixed order; within a group, best match first.
    return GROUP_ORDER.flatMap((g) => [...shownCases, ...shownOthers].filter((r) => r.item.group === g).map((r) => r.item));
  }, [query, cases, commands]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runItem = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    // After the palette has gone, so focus restoration doesn't fight a page change.
    requestAnimationFrame(() => item.run());
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === "Home" && items.length) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && items.length) {
      event.preventDefault();
      setActive(items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(items[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      // The search field is the palette's only stop: Tab stays inside.
      event.preventDefault();
      input.current?.focus();
    }
  };

  const activeId = items[active] ? `${listId}-${items[active].id}` : undefined;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12dvh]" onKeyDown={onKey}>
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="float relative flex max-h-[min(76dvh,520px)] w-full max-w-[600px] flex-col overflow-hidden rounded-md border border-line bg-paper"
        initial={{ opacity: 0, scale: 0.98, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -6, transition: { duration: 0.1 } }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <div className="flex h-14 flex-none items-center gap-3 border-b border-line px-4">
          <Search aria-hidden className="size-4 flex-none text-dim" strokeWidth={1.75} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search claims, pages and actions"
            placeholder={isNarrow ? "Search…" : "Search claims, pages and actions…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-16 text-ink outline-none placeholder:text-dim focus-visible:outline-none"
          />
          <kbd className="kbd hidden sm:inline-grid">esc</kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-2">
          {items.length === 0 && <p className="m-0 px-4 py-8 text-center text-14 text-dim">Nothing matches “{query.trim()}”.</p>}
          {GROUP_ORDER.map((group) => {
            const members = items.map((item, index) => ({ item, index })).filter(({ item }) => item.group === group);
            if (members.length === 0) return null;
            const title = group === "Claims" && !query.trim() ? "Expiring soon" : group;
            return (
              <div key={group} role="group" aria-labelledby={`${listId}-${group}`} className="pb-1">
                <div id={`${listId}-${group}`} role="presentation" className="px-4 pb-1 pt-2 text-12 font-medium text-dim">
                  {title}
                </div>
                {members.map(({ item, index }) => {
                  const isActive = index === active;
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      role="option"
                      aria-selected={isActive}
                      data-index={index}
                      onPointerMove={() => !isActive && setActive(index)}
                      onClick={() => runItem(item)}
                      className={cn("mx-2 flex h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 text-14", isActive && "bg-ground")}
                    >
                      <span className="grid size-5 flex-none place-items-center text-dim">{item.icon}</span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate font-medium">{item.label}</span>
                        {item.detail && <span className="hidden truncate text-13 text-dim sm:inline">{item.detail}</span>}
                      </span>
                      {item.hint}
                      <CornerDownLeft aria-hidden className={cn("size-3.5 flex-none text-dim", !isActive && "invisible")} strokeWidth={2} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="hidden flex-none items-center gap-4 border-t border-line px-4 py-2.5 text-12 text-dim sm:flex">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↵</kbd> to open
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">esc</kbd> to close
          </span>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
