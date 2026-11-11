import { useCallback, useEffect, useState } from "react";
import { api, type Sources } from "../api";

const POLL_MS = 60_000;

/** Where each data source stands, polled every minute. A missing endpoint just means "unknown". */
export function useSources() {
  const [sources, setSources] = useState<Sources | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);

  const reload = useCallback(async () => {
    try {
      setSources(await api.sources());
      setIsAvailable(true);
    } catch {
      setIsAvailable(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  return { sources, isAvailable, reload };
}
