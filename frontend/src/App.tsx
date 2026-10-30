import { MotionConfig, motion } from "motion/react";
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
import { SPRING } from "./motion";

// Four ice glows, fixed and blurred behind everything. Rendered once.
function Glows() {
  const glows = [
    { color: "var(--glow-1)", size: "58vmax", left: "-18vmax", top: "-22vmax" },
    { color: "var(--glow-2)", size: "44vmax", left: "62vw", top: "-14vmax" },
    { color: "var(--glow-3)", size: "50vmax", left: "30vw", top: "38vh" },
    { color: "var(--glow-4)", size: "40vmax", left: "-10vmax", top: "62vh" },
  ];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {glows.map((glow) => (
        <div
          key={glow.color}
          className="absolute rounded-full blur-[90px]"
          style={{
            background: glow.color,
            opacity: "var(--glow-opacity)",
            width: glow.size,
            height: glow.size,
            left: glow.left,
            top: glow.top,
          }}
        />
      ))}
    </div>
  );
}

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

  const act = async (kind: "case" | "run" | "advance", work: () => Promise<string | void>): Promise<boolean> => {
    setBusy(kind);
    try {
      const message = await work();
      await refresh();
      if (message) notify(message);
      return true;
    } catch (err) {
      notify(errorText(err), "error");
      return false;
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
      onSave={async (draftId, subject, body) => {
        const ok = await act("case", async () => {
          await api.editDraft(draftId, subject, body);
        });
        if (!ok) throw new Error("Could not save the draft.");
      }}
      onSend={async (draftId) => {
        const ok = await act("case", async () => {
          const sent = await api.send(draftId);
          return `Sent to ${sent.to_addr}. It's under Waiting until the vendor replies.`;
        });
        if (!ok) throw new Error("Could not send.");
      }}
    />
  );

  const showQueue = !isNarrow || !isCaseOpen;
  const showCase = !isNarrow || isCaseOpen;

  return (
    <MotionConfig reducedMotion="user">
    <Glows />
    <div className="relative min-h-dvh text-ink">
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
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
          <div role="alert" className="glass rounded-card px-5 py-4 text-sm">
            {error}
          </div>
        )}

        {summary && showQueue && <Metrics summary={summary} />}

        {isLoading ? (
          <p className="text-sm text-dim">Loading cases…</p>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 min-[900px]:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
            {showQueue && (
              <div className={isNarrow ? "min-w-0" : "sticky top-6 min-w-0"}>
                <Queue
                  findings={findings}
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
              <div className="min-w-0">
                {selectedId === null ? (
                  <div className="glass-lg rounded-panel px-8 py-12 text-center text-[15px] text-dim">
                    {summary && summary.recovered_minor > 0
                      ? `${formatMoney(summary.recovered_minor)} recovered so far. Pick a case to see its evidence.`
                      : "Pick a case on the left to see what is owed, why, and what to do next."}
                  </div>
                ) : (
                  <article aria-label={detail ? `${detail.merchant} case` : "Case"} className="relative rounded-panel">
                    {/* The surface alone carries the shared layoutId, so on a phone the queue row grows
                        into it without stretching the text; the content fades in on top. */}
                    <motion.div
                      aria-hidden
                      layoutId={isNarrow ? `case-${selectedId}` : undefined}
                      transition={SPRING}
                      className="glass-lg absolute inset-0 rounded-panel"
                    />
                    <motion.div
                      key={selectedId}
                      className="relative"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      {caseError && <p className="px-6 py-8 text-sm text-dim">{caseError}</p>}
                      {!caseError && !detail && <p className="px-6 py-8 text-sm text-dim">Loading case…</p>}
                      {caseView}
                    </motion.div>
                  </article>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
    </MotionConfig>
  );
}
