import { useEffect, useState } from "react";
import { api, type FindingDetail } from "../api";

// `version` bumps after any action so the open case refetches.
export function useCase(id: number | null, version: number) {
  const [detail, setDetail] = useState<FindingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) {
      setDetail(null);
      return;
    }
    let isCurrent = true;
    setError(null);
    api
      .finding(id)
      .then((data) => {
        if (isCurrent) setDetail(data);
      })
      .catch(() => {
        if (isCurrent) setError("Could not load this case.");
      });
    return () => {
      isCurrent = false;
    };
  }, [id, version]);

  return { detail: detail && detail.id === id ? detail : null, error };
}
