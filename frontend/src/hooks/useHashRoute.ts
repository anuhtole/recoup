import { useCallback, useEffect, useState } from "react";

export type Page = "overview" | "claims";
export interface Route {
  page: Page;
  caseId: number | null;
}

// #/overview, #/claims, #/claims/<id>. Anything else is the overview.
export function parseHash(hash: string): Route {
  const match = /^#\/claims(?:\/(\d+))?\/?$/.exec(hash);
  if (match) return { page: "claims", caseId: match[1] ? Number(match[1]) : null };
  return { page: "overview", caseId: null };
}

export function hrefFor(route: Route): string {
  return route.page === "claims" ? `#/claims${route.caseId !== null ? `/${route.caseId}` : ""}` : "#/overview";
}

/**
 * The page lives in the URL hash, so refresh and back/forward work and a row can deep-link to a case.
 * `go` adds a history entry; `replace` (for moving through the queue) does not.
 */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((next: Route) => {
    const href = hrefFor(next);
    if (window.location.hash === href) setRoute(next);
    else window.location.hash = href;
  }, []);
  const replace = useCallback((next: Route) => {
    window.history.replaceState(null, "", hrefFor(next));
    setRoute(next);
  }, []);
  return { route, go, replace };
}
