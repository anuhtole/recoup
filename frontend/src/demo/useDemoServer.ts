import { useCallback, useEffect, useState } from "react";
import { api, type DemoServer } from "../api";

/**
 * Where the scripted demo stands on the server (GET /api/demo/state). Outside demo mode, or on an older
 * API, the call fails and `server` stays null: the flow then reads the same facts off the sources and
 * the findings.
 */
export function useDemoServer() {
  const [server, setServer] = useState<DemoServer | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setServer(await api.demoState());
    } catch {
      // Keep what was last known: one failed call (the API restarting) is not a reset.
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { server, isLoaded, reload };
}
