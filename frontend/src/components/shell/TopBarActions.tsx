import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/** The element in the top bar where the current page puts its own actions (Overview's Export). */
export const TopBarSlot = createContext<HTMLElement | null>(null);

/** Renders a page's actions into the top bar, beside the page title, so the page needn't repeat a header. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlot);
  return slot ? createPortal(children, slot) : null;
}
