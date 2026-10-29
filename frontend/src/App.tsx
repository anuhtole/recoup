import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Stage } from "./api";
import { CaseView } from "./components/case/CaseView";
import { Metrics } from "./components/Metrics";
import { Queue } from "./components/Queue";
import { Toast, type ToastMessage } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { formatDate, formatMoney } from "./format";
import { useCase } from "./hooks/useCase";
import { useCases } from "./hooks/useCases";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { COLORS, FONTS, card } from "./theme";

const ADVANCE_DAYS = 14;

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Check the API logs.";
}

export function App() {
  const { summary, findings, error, isLoading, reload } = useCases();
  const [stage, setStage] = useState<Stage>("todo");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"case" | "run" | "advance" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const isNarrow = useIsNarrow();
  const { detail, error: caseError } = useCase(selectedId, version);

  const visible = useMemo(() => findings.filter((f) => f.stage === stage), [findings, stage]);
  const ids = useMemo(() => visible.map((f) => f.id), [visible]);
  const counts = useMemo(() => {
    const total: Record<Stage, number> = { todo: 0, waiting: 0, done: 0 };
    findings.forEach((f) => (total[f.stage] += 1));
    return total;
  }, [findings]);

  // On wide screens keep a case open: the first one in the tab if nothing is selected.
  useEffect(() => {
    if (!isNarrow && selectedId === null && ids.length > 0) setSelectedId(ids[0]);
  }, [ids, isNarrow, selectedId]);

  const select = useCallback(
    (id: number) => {
      setSelectedId(id);
      setIsCaseOpen(true);
      if (isNarrow) window.scrollTo({ top: 0 });
    },
    [isNarrow],
  );
  useKeyboardNav(ids, selectedId, select);

  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  const refresh = useCallback(async () => {
    await reload();
    setVersion((v) => v + 1);
  }, [reload]);

  const act = async (kind: "case" | "run" | "advance", work: () => Promise<string | void>) => {
    setBusy(kind);
    try {
      const message = await work();
      await refresh();
      if (message) notify(message);
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const changeStage = (next: Stage) => {
    setStage(next);
    const first = findings.find((f) => f.stage === next);
    setSelectedId(first ? first.id : null);
  };

  const caseView = detail && (
    <CaseView
      detail={detail}
      isBusy={busy === "case"}
      onBack={isNarrow ? () => setIsCaseOpen(false) : undefined}
      onDraft={() =>
        void act("case", async () => {
          await api.draft(detail.id);
          return "Draft ready. Review it, then approve.";
        })
      }
      onDismiss={(reason) =>
        void act("case", async () => {
          await api.dismiss(detail.id, reason);
          return "Case dismissed. The reason is in the audit trail.";
        })
      }
      onSave={(draftId, subject, body) =>
        act("case", async () => {
          await api.editDraft(draftId, subject, body);
        })
      }
      onSend={(draftId) =>
        act("case", async () => {
          const sent = await api.send(draftId);
          return `Sent to ${sent.to_addr}. It's under Waiting until the vendor replies.`;
        })
      }
    />
  );

  const showQueue = !isNarrow || !isCaseOpen;
  const showCase = !isNarrow || isCaseOpen;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.backdrop, color: COLORS.ink, fontFamily: FONTS.serif }}>
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 16px 64px" }}>
        <TopBar
          summary={summary}
          isRunning={busy === "run"}
          isAdvancing={busy === "advance"}
          onRun={() =>
            void act("run", async () => {
              const run = await api.runPipeline();
              return `Read ${run.emails_read} emails · ${run.created} new, ${run.recovered} recovered.`;
            })
          }
          onAdvance={() =>
            void act("advance", async () => {
              const result = await api.advance(ADVANCE_DAYS);
              const found = result.run.created ? ` · ${result.run.created} new found` : "";
              return `Now ${formatDate(result.as_of)}: ${result.replies} vendor replies, ${result.run.recovered} credits confirmed${found}.`;
            })
          }
        />

        {error && (
          <div role="alert" style={{ ...card, padding: 14, marginBottom: 16, fontFamily: FONTS.mono, fontSize: 13 }}>
            {error}
          </div>
        )}

        {summary && (!isNarrow || !isCaseOpen) && <Metrics summary={summary} />}

        {isLoading ? (
          <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.inkDim }}>Loading cases…</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrow ? "1fr" : "minmax(320px, 400px) 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            {showQueue && (
              <div style={{ position: isNarrow ? "static" : "sticky", top: 16 }}>
                <Queue
                  findings={visible}
                  stage={stage}
                  counts={counts}
                  selectedId={selectedId}
                  onStage={changeStage}
                  onSelect={select}
                  isNarrow={isNarrow}
                />
              </div>
            )}
            {showCase && (
              <div style={{ minWidth: 0 }}>
                {caseError && <div style={{ ...card, padding: 20, fontFamily: FONTS.mono }}>{caseError}</div>}
                {caseView}
                {!caseView && !caseError && selectedId === null && (
                  <div style={{ ...card, padding: 28, fontFamily: FONTS.serif, fontSize: 18, color: COLORS.inkDim }}>
                    {summary && summary.recovered_minor > 0
                      ? `${formatMoney(summary.recovered_minor)} recovered so far. Pick a case to see its story.`
                      : "Pick a case to see the evidence and what to do next."}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
