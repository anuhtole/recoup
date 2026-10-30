import { MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Finding, type Stage } from "./api";
import { CaseView } from "./components/case/CaseView";
import { Metrics } from "./components/Metrics";
import { Queue } from "./components/Queue";
import { type Notice, Notifications } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { formatDate, formatMoney } from "./format";
import { useCase } from "./hooks/useCase";
import { useCases } from "./hooks/useCases";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { SPRING } from "./motion";

const ADVANCE_DAYS = 14;

type NoticeInput = Omit<Notice, "id">;

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

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Check the API logs.";
}

/** One card per vendor reply and per credit the ledger confirmed while the clock moved. */
function advanceNotices(before: Finding[], after: Finding[], asOf: string): NoticeInput[] {
  const previous = new Map(before.map((f) => [f.id, f]));
  const notices: NoticeInput[] = [];
  let created = 0;
  for (const f of after) {
    const was = previous.get(f.id);
    if (!was) {
      created += 1;
      continue;
    }
    if (was.status === f.status) continue;
    const amount = formatMoney(f.amount_minor, f.currency);
    if (f.status === "recovered") {
      const back = formatMoney(f.recovered_minor ?? f.amount_minor, f.currency);
      notices.push({ tone: "money", title: `${f.merchant} credit posted`, body: `${back} is back, confirmed in your ledger.` });
    } else if (f.status === "vendor_agreed") {
      notices.push({ tone: "info", title: `${f.merchant} agreed to refund ${amount}`, body: "Recoup closes it when the credit posts." });
    } else if (f.status === "info_requested") {
      notices.push({ tone: "info", title: `${f.merchant} asked for more details`, body: "It is back under To do." });
    } else if (f.status === "vendor_declined") {
      notices.push({ tone: "info", title: `${f.merchant} declined`, body: "It is back under To do with what you can do next." });
    } else if (f.status === "expired") {
      notices.push({ tone: "info", title: `${f.merchant}: the claim window closed`, body: `${amount} moved to Missed.` });
    }
  }
  if (created > 0) {
    notices.push({ tone: "info", title: created === 1 ? "1 new case found" : `${created} new cases found` });
  }
  if (notices.length === 0) {
    notices.push({ tone: "info", title: `Now ${formatDate(asOf)}`, body: "No vendor replies or credits in these two weeks." });
  }
  return notices;
}

export function App() {
  const { summary, findings, error, isLoading, reload } = useCases();
  const [stage, setStage] = useState<Stage>("todo");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"case" | "run" | "advance" | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const listScroll = useRef(0);
  const nextNoticeId = useRef(1);
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
      if (isNarrow && !isCaseOpen) listScroll.current = window.scrollY;
      setSelectedId(id);
      setIsCaseOpen(true);
      if (isNarrow) window.scrollTo({ top: 0 });
    },
    [isNarrow, isCaseOpen],
  );
  useKeyboardNav(ids, selectedId, select);

  const closeCase = () => {
    setIsCaseOpen(false);
    // Back returns to the list where it was.
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
  };

  const notify = useCallback((items: NoticeInput[]) => {
    setNotices((current) => [...current, ...items.map((item) => ({ ...item, id: nextNoticeId.current++ }))]);
  }, []);
  const dismissNotice = useCallback((id: number) => setNotices((current) => current.filter((n) => n.id !== id)), []);

  const refresh = useCallback(async () => {
    await reload();
    setVersion((v) => v + 1);
  }, [reload]);

  const act = async (
    kind: "case" | "run" | "advance",
    work: () => Promise<string | NoticeInput[] | void>,
  ): Promise<boolean> => {
    setBusy(kind);
    try {
      const message = await work();
      await refresh();
      if (typeof message === "string") notify([{ tone: "info", title: message }]);
      else if (message) notify(message);
      return true;
    } catch (err) {
      notify([{ tone: "error", title: "That did not go through", body: errorText(err) }]);
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
      onBack={isNarrow ? closeCase : undefined}
      onDraft={() =>
        void act("case", async () => {
          // The draft appears in place; no notice needed.
          await api.draft(detail.id);
        })
      }
      onDismiss={(reason) =>
        void act("case", async () => {
          await api.dismiss(detail.id, reason);
          return [{ tone: "info", title: "Case dismissed", body: "The reason is kept in its history." }];
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
          return [{ tone: "info", title: `Sent to ${sent.to_addr}`, body: "It waits under Waiting until the vendor replies." }];
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
        <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8">
          <TopBar
            summary={summary}
            isRunning={busy === "run"}
            isAdvancing={busy === "advance"}
            onRun={() =>
              void act("run", async () => {
                const run = await api.runPipeline();
                return [
                  {
                    tone: "info",
                    title: run.created ? `${run.created} new ${run.created === 1 ? "case" : "cases"} found` : "Nothing new found",
                    body: `Read ${run.emails_read} emails and the ledger.`,
                  },
                ];
              })
            }
            onAdvance={() =>
              void act("advance", async () => {
                const before = findings;
                const result = await api.advance(ADVANCE_DAYS);
                const after = await api.findings();
                return advanceNotices(before, after, result.as_of);
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
        <Notifications notices={notices} onDismiss={dismissNotice} />
      </div>
    </MotionConfig>
  );
}
