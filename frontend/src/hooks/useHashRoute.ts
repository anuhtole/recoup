import { useCallback, useEffect, useState } from "react";

export type Page = "agent" | "overview" | "claims" | "recovered" | "sources" | "setup";
export interface Route {
  page: Page;
  /** #/claims/<id> */
  caseId: number | null;
  /** What a page keeps in the hash: the claims list's filters (tab, q, type), Recovered's view. */
  params: Record<string, string>;
}

const PAGES: Page[] = ["agent", "overview", "claims", "recovered", "sources", "setup"];

// #/agent, #/overview, #/claims?tab=waiting&q=fig&type=sla_credit, #/claims/<id>, #/recovered,
// #/recovered?view=inflight, #/sources, #/setup.
// Anything else is the agent page.
export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const page = PAGES.includes(parts[0] as Page) ? (parts[0] as Page) : "agent";
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
