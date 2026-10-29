import { useCallback, useEffect, useState } from "react";
import { api, type Finding, type Summary } from "../api";

interface CasesState {
  summary: Summary | null;
  findings: Finding[];
  error: string | null;
  isLoading: boolean;
  reload: () => Promise<void>;
}

export function useCases(): CasesState {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [nextSummary, nextFindings] = await Promise.all([api.summary(), api.findings()]);
      setSummary(nextSummary);
      setFindings(nextFindings);
      setError(null);
    } catch {
      setError("Could not reach the Recoup API. Is it running on port 8000?");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { summary, findings, error, isLoading, reload };
}
