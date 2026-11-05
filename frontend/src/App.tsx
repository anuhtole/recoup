import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Finding, type Stage } from "./api";
import { CaseView } from "./components/case/CaseView";
import { Overview } from "./components/Overview";
import { Queue } from "./components/Queue";
import { type Notice, Notifications } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { formatDate, formatMoney } from "./format";
import { useCase } from "./hooks/useCase";
import { useCases } from "./hooks/useCases";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSources } from "./hooks/useSources";
import { SourcesSheet, syncNotice } from "./components/Sources";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { SPRING } from "./motion";
import { orderStage } from "./queue";
import { LEAK_LABEL } from "./theme";

const ADVANCE_DAYS = 14;

type NoticeInput = Omit<Notice, "id">;

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // fetch rejects with a TypeError when the server can't be reached at all.
  if (error instanceof TypeError) return "Couldn't reach the Recoup server. Check that it's running and try again.";
  return "Something went wrong. Check the API logs.";
}

/** One card per vendor reply and per credit the ledger confirmed while the clock moved. */
function advanceNotices(
  before: Finding[],
  after: Finding[],
  asOf: string,
  openCase: (id: number) => void,
): NoticeInput[] {
  const previous = new Map(before.map((f) => [f.id, f]));
  const notices: NoticeInput[] = [];
  const created: Finding[] = [];
  for (const f of after) {
    const was = previous.get(f.id);
    if (!was) {
      created.push(f);
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
  if (created.length === 1) {
    const [f] = created;
    notices.push({
      tone: "info",
      title: "New case found",
      body: `${f.merchant}, ${formatMoney(f.amount_minor, f.currency)}: ${LEAK_LABEL[f.leak_type].toLowerCase()}.`,
      action: { label: "Open case", onClick: () => openCase(f.id) },
    });
  } else if (created.length > 1) {
    notices.push({
      tone: "info",
      title: `${created.length} new cases found`,
      body: "They are under To do.",
      action: { label: "Review claims", onClick: () => openCase(created[0].id) },
    });
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
  const [busy, setBusy] = useState<"case" | "run" | "advance" | "sync" | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const listScroll = useRef(0);
  const nextNoticeId = useRef(1);
  const isNarrow = useIsNarrow();
  const { detail, error: caseError } = useCase(selectedId, version);
  const { route, go, replace } = useHashRoute();
  const { sources, isAvailable: sourcesAvailable, reload: reloadSources } = useSources();
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const isClaims = route.page === "claims";

  // The same order the queue shows: live cases by days left, then the closed-window group.
  const ids = useMemo(() => {
    const { live, closed } = orderStage(findings, stage);
    return [...live, ...closed].map((f) => f.id);
  }, [findings, stage]);
  const counts = useMemo(
    () => ({
      todo: orderStage(findings, "todo").live.length,
      waiting: findings.filter((f) => f.stage === "waiting").length,
      done: findings.filter((f) => f.stage === "done").length,
    }),
    [findings],
  );

  // A hash like #/claims/12 opens that case in its tab (from a link, a refresh, or back/forward).
  useEffect(() => {
    if (!isClaims || route.caseId === null || isLoading) return;
    const finding = findings.find((f) => f.id === route.caseId);
    if (!finding) return;
    setStage(finding.stage);
    setSelectedId(finding.id);
    setIsCaseOpen(true);
    // Only when the hash changes or the data first arrives, not on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClaims, route.caseId, isLoading]);

  // On a phone the open case follows the address: #/claims alone is the list.
  useEffect(() => {
    if (isClaims && route.caseId === null) setIsCaseOpen(false);
  }, [isClaims, route.caseId]);

  // A new page starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.page]);

  // On wide screens keep a case open: the first one in the tab if nothing is selected.
  useEffect(() => {
    // A case named in the address wins over the default first row.
    if (!isNarrow && selectedId === null && ids.length > 0 && route.caseId === null) setSelectedId(ids[0]);
  }, [ids, isNarrow, selectedId, route.caseId]);

  const select = useCallback(
    (id: number) => {
      if (isNarrow && !isCaseOpen) listScroll.current = window.scrollY;
      setSelectedId(id);
      setIsCaseOpen(true);
      // Moving through the queue updates the address without piling up history.
      replace({ page: "claims", caseId: id });
      if (isNarrow) window.scrollTo({ top: 0 });
    },
    [isNarrow, isCaseOpen, replace],
  );
  // j / k only move through the queue on the Claims page.
  useKeyboardNav(isClaims ? ids : [], selectedId, select);

  const closeCase = () => {
    setIsCaseOpen(false);
    replace({ page: "claims", caseId: null });
    // Back returns to the list where it was.
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
  };

  // Advance results stack; a routine notice replaces the one before it.
  const notify = useCallback((items: NoticeInput[]) => {
    setNotices((current) => {
      const hasRoutine = items.some((item) => !item.isResult);
      const kept = hasRoutine ? current.filter((n) => n.isResult) : current;
      return [...kept, ...items.map((item) => ({ ...item, id: nextNoticeId.current++ }))];
    });
  }, []);
  const dismissNotice = useCallback((id: number) => setNotices((current) => current.filter((n) => n.id !== id)), []);

  const refresh = useCallback(async () => {
    await reload();
    setVersion((v) => v + 1);
  }, [reload]);

  const act = async (
    kind: "case" | "run" | "advance" | "sync",
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
      notify([{ tone: "error", title: kind === "sync" ? "Sync didn't finish" : "That did not go through", body: errorText(err) }]);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const changeStage = (next: Stage) => {
    setStage(next);
    const { live, closed } = orderStage(findings, next);
    const first = live[0] ?? closed[0];
    setSelectedId(first ? first.id : null);
  };

  const caseView = detail && (
    <CaseView
      detail={detail}
      isBusy={busy === "case"}
      isDemo={summary?.data_mode === "demo"}
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
          return [
            {
              tone: "info",
              isResult: true,
              title: `${sent.channel === "card_dispute" ? "Dispute" : "Request"} sent to ${sent.to_addr}`,
              body:
                summary?.data_mode === "demo"
                  ? "Demo: kept in Recoup's outbox, no email went out. The case is under Waiting until the vendor replies."
                  : "The case is now under Waiting until the vendor replies.",
            },
          ];
        });
        if (!ok) throw new Error("Could not send.");
      }}
      // Once the sheet is gone, show the case where it now lives: the Waiting tab, still selected.
      onSent={() => setStage("waiting")}
    />
  );

  const showQueue = !isNarrow || !isCaseOpen;
  const showCase = !isNarrow || isCaseOpen;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-dvh text-ink">
        <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8">
          <TopBar
            page={route.page}
            summary={summary}
            sources={sources}
            onOpenSources={() => {
              setIsSourcesOpen(true);
              void reloadSources();
            }}
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
                const openCase = (id: number) => go({ page: "claims", caseId: id });
                return advanceNotices(before, after, result.as_of, openCase).map((notice) => ({ ...notice, isResult: true }));
              })
            }
          />

          {error && (
            <div role="alert" className="rounded-card bg-tint px-5 py-4 text-14">
              {error}
            </div>
          )}

          {!isClaims && summary && !isLoading && (
            <Overview
              summary={summary}
              findings={findings}
              onOpenCase={(id) => go({ page: "claims", caseId: id })}
              onReview={() => {
                changeStage("todo");
                setIsCaseOpen(false);
                go({ page: "claims", caseId: null });
              }}
            />
          )}

          {isLoading ? (
            <p className="text-14 text-dim">Loading cases…</p>
          ) : (
            isClaims && <div className="grid grid-cols-1 items-start gap-6 min-[900px]:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
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
                    <div className="glass-lg rounded-panel px-8 py-12 text-center text-16 text-dim">
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
                        {caseError && <p className="px-6 py-8 text-14 text-dim">{caseError}</p>}
                        {!caseError && !detail && <p className="px-6 py-8 text-14 text-dim">Loading case…</p>}
                        {caseView}
                      </motion.div>
                    </article>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
        <AnimatePresence>
          {isSourcesOpen && (
            <SourcesSheet
              key="sources"
              sources={sources}
              isAvailable={sourcesAvailable}
              isSyncing={busy === "sync"}
              onClose={() => setIsSourcesOpen(false)}
              onSync={() =>
                void act("sync", async () => {
                  try {
                    const notice = syncNotice(await api.sync());
                    return [{ tone: notice.ok ? "info" : "error", title: notice.title, body: notice.body }];
                  } finally {
                    await reloadSources();
                  }
                })
              }
            />
          )}
        </AnimatePresence>
        <Notifications notices={notices} onDismiss={dismissNotice} />
      </div>
    </MotionConfig>
  );
}
