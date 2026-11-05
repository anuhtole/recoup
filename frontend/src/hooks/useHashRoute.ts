import { useCallback, useEffect, useState } from "react";

export type Page = "overview" | "claims" | "recovered" | "sources";
export interface Route {
  page: Page;
  /** #/claims/<id> */
  caseId: number | null;
  /** Claims list filters, kept in the hash: tab, q, type. */
  params: Record<string, string>;
}

const PAGES: Page[] = ["overview", "claims", "recovered", "sources"];

// #/overview, #/claims?tab=waiting&q=fig&type=sla_credit, #/claims/<id>, #/recovered, #/sources.
// Anything else is the overview.
export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const page = PAGES.includes(parts[0] as Page) ? (parts[0] as Page) : "overview";
  const caseId = page === "claims" && parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => {
    if (value) params[key] = value;
  });
  return { page, caseId, params };
}

export function hrefFor(route: Partial<Route> & { page: Page }): string {
  let href = `#/${route.page}`;
  if (route.page === "claims" && route.caseId != null) href += `/${route.caseId}`;
  const query = new URLSearchParams(Object.entries(route.params ?? {}).filter(([, v]) => v)).toString();
  return query ? `${href}?${query}` : href;
}

/**
 * The page lives in the URL hash, so refresh and back/forward work and any case or filtered list deep-links.
 * `go` adds a history entry; `replace` (typing in search, moving between cases) does not.
 */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((next: Partial<Route> & { page: Page }) => {
    const href = hrefFor(next);
    if (window.location.hash === href) setRoute(parseHash(href));
    else window.location.hash = href;
  }, []);
  const replace = useCallback((next: Partial<Route> & { page: Page }) => {
    const href = hrefFor(next);
    window.history.replaceState(null, "", href);
    setRoute(parseHash(href));
  }, []);
  return { route, go, replace };
}
