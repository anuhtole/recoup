import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type Finding } from "./api";
import { Shell } from "./components/shell/Shell";
import { syncNotice } from "./components/Sources";
import { type Notice, Notifications } from "./components/Toast";
import { demo, useDemo } from "./demo/flow";
import { useDemoServer } from "./demo/useDemoServer";
import { formatDate, formatMoney, plural, setReferenceYear } from "./format";
import { useCase } from "./hooks/useCase";
import { useCases } from "./hooks/useCases";
import { hrefFor, useHashRoute } from "./hooks/useHashRoute";
import { useSources } from "./hooks/useSources";
import { downloadClaims } from "./lib/exportCsv";
import { vendorName } from "./lib/vendors";
import { Agent } from "./pages/Agent";
import { CasePage } from "./pages/Case";
import { Claims, type ClaimsParams, readParams, visibleIds, writeParams } from "./pages/Claims";
import { Overview } from "./pages/Overview";
import type { Page } from "./hooks/useHashRoute";
import { Recovered, recoveredView } from "./pages/Recovered";
import { Setup } from "./components/setup/Setup";
import { SourcesPage } from "./pages/SourcesPage";
import { countsFor, rowsFor, tabOf } from "./queue";

const ADVANCE_DAYS = 14;

const PAGE_TITLE: Record<Page, string> = { agent: "Agent", overview: "Overview", claims: "Claims", recovered: "Recovered", sources: "Sources", setup: "Setup" };

type NoticeInput = Omit<Notice, "id">;
type Busy = "case" | "run" | "advance" | "sync" | "bulk" | "restart" | null;

/** How many results show as separate cards before they fold into one summary card. */
const MAX_RESULT_CARDS = 3;

/**
 * What changed while the clock moved: one card per vendor reply, credit and closed window, the ones that
 * need you (declined, asked for details) first. More than three fold into one summary card that lists
 * them all, so nothing actionable is hidden behind newer cards.
 */
function advanceNotices(before: Finding[], after: Finding[], asOf: string): NoticeInput[] {
  const previous = new Map(before.map((f) => [f.id, f]));
  const notices: (NoticeInput & { rank: number; short: string })[] = [];
  let created = 0;
  for (const f of after) {
    const was = previous.get(f.id);
    if (!was) {
      created += 1;
      continue;
    }
    if (was.status === f.status) continue;
    const vendor = vendorName(f.merchant);
    const amount = formatMoney(f.amount_minor, f.currency);
    if (f.status === "recovered") {
      const back = formatMoney(f.recovered_minor ?? f.amount_minor, f.currency);
      notices.push({ rank: 2, short: "credit posted", tone: "money", title: `${vendor} credit posted`, body: `${back} is back, confirmed in your ledger.` });
    } else if (f.status === "vendor_agreed") {
      notices.push({ rank: 3, short: "agreed", tone: "info", title: `${vendor} agreed to refund ${amount}`, body: "It closes when the credit posts." });
    } else if (f.status === "info_requested") {
      notices.push({ rank: 1, short: "asked for details", tone: "info", title: `${vendor} asked for more details`, body: "It's back under To do." });
    } else if (f.status === "vendor_declined") {
      notices.push({ rank: 1, short: "declined", tone: "info", title: `${vendor} declined`, body: "It's back under To do." });
    } else if (f.status === "expired") {
      notices.push({ rank: 4, short: "window closed", tone: "info", title: `${vendor}'s claim window closed`, body: `${amount} moved to Window closed.` });
    }
  }
  if (created > 0) notices.push({ rank: 5, short: "new", tone: "info", title: created === 1 ? "1 new claim found" : `${created} new claims found` });
  if (notices.length === 0) return [{ tone: "info", title: `Moved to ${formatDate(asOf)}`, body: "No replies or credits in those two weeks." }];
  notices.sort((a, b) => a.rank - b.rank);
  if (notices.length <= MAX_RESULT_CARDS) return notices.map(({ rank: _rank, short: _short, ...n }) => n);
  // "3 credits posted · 1 declined · 1 new claim", then every result on its own line, the ones that need you first.
  const counts = new Map<string, number>();
  for (const n of notices) counts.set(n.short, (counts.get(n.short) ?? 0) + (n.short === "new" ? created : 1));
  const phrase = (short: string, n: number) =>
    short === "credit posted" ? `${n} ${n === 1 ? "credit" : "credits"} posted` : short === "new" ? plural(n, "new claim") : `${n} ${short}`;
  return [
    {
      tone: notices.some((n) => n.tone === "money") ? "money" : "info",
      title: [...counts.entries()].map(([short, n]) => phrase(short, n)).join(" · "),
      lines: notices.map((n) => n.title),
    },
  ];
}

export function App() {
  const { summary, findings, error, isLoading, reload } = useCases();
  const { route, go, replace } = useHashRoute();
  const { sources, isAvailable: sourcesAvailable, reload: reloadSources } = useSources();
  const { server, isLoaded: isServerLoaded, reload: reloadServer } = useDemoServer();
  const { busy: demoBusy, isReady: isDemoReady } = useDemo();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextNoticeId = useRef(1);

  // List dates drop the year when it is the demo's (or this) year.
  if (summary) setReferenceYear(summary.as_of);

  const caseId = route.page === "claims" ? route.caseId : null;
  const { detail, error: caseError } = useCase(caseId, version);
  const counts = useMemo(() => countsFor(findings), [findings]);

  // The list a case was opened from: its filters give prev / next, and "Claims" goes back to it.
  const listParams = useRef<ClaimsParams>(readParams({}));
  const listScroll = useRef(0);
  const claimsParams = readParams(route.params);
  if (route.page === "claims" && caseId === null) listParams.current = claimsParams;

  // A new page or case starts at the top; returning to the list restores where it was.
  const scrollKey = `${route.page}/${caseId ?? ""}`;
  const lastKey = useRef(scrollKey);
  useEffect(() => {
    const wasCase = /^claims\/\d+$/.test(lastKey.current);
    lastKey.current = scrollKey;
    if (wasCase && scrollKey === "claims/") requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
    else window.scrollTo({ top: 0 });
  }, [scrollKey]);

  // Prev/next walk the list you came from. A case that just left it (sent, dismissed) walks its new
  // stage instead, without a "1 of 1" count that would read as the list having emptied.
  const { navIds, inList } = useMemo(() => {
    if (caseId === null) return { navIds: [] as number[], inList: false };
    const fromList = visibleIds(findings, listParams.current);
    if (fromList.includes(caseId)) return { navIds: fromList, inList: true };
    const finding = findings.find((f) => f.id === caseId);
    return { navIds: finding ? visibleIds(findings, { tab: tabOf(finding), q: "", type: null }) : [], inList: false };
  }, [findings, caseId]);
  const navIndex = caseId === null ? -1 : navIds.indexOf(caseId);

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
    await Promise.all([reload(), reloadServer()]);
    setVersion((v) => v + 1);
  }, [reload, reloadServer]);

  // The scripted demo runs outside React (demo/flow.ts). It reloads everything here after each of its
  // actions, and is handed the server's data whenever that changes, to keep its step in line with it.
  useEffect(() => {
    demo.bind(async () => {
      await Promise.all([refresh(), reloadSources()]);
    });
  }, [refresh, reloadSources]);
  // Before paint, so a stored conversation that the server has moved past never shows.
  const isSourcesKnown = sources !== null || !sourcesAvailable;
  useLayoutEffect(() => {
    if (summary && isServerLoaded && (server || isSourcesKnown)) demo.sync({ summary, findings, sources, server });
  }, [summary, findings, sources, server, isServerLoaded, isSourcesKnown]);

  const act = async (kind: Exclude<Busy, null>, work: () => Promise<string | NoticeInput[] | void>): Promise<boolean> => {
    setBusy(kind);
    try {
      const message = await work();
      await refresh();
      if (typeof message === "string") notify([{ tone: "info", title: message }]);
      else if (message) notify(message);
      return true;
    } catch (err) {
      await refresh().catch(() => undefined);
      notify([{ tone: "error", title: kind === "sync" ? "Sync didn't finish" : "That didn't go through", body: errorText(err) }]);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openCase = useCallback(
    (id: number) => {
      listScroll.current = window.scrollY;
      go({ page: "claims", caseId: id });
    },
    [go],
  );
  const backToList = useCallback(() => go({ page: "claims", params: writeParams(listParams.current) }), [go]);
  const navigateCase = useCallback((id: number) => replace({ page: "claims", caseId: id }), [replace]);

  // Export: CSV built in the browser. The top bar and ⌘K export the open claims; Claims exports what it shows.
  const exportRows = useCallback(
    (rows: Finding[], noun = "claim") => {
      downloadClaims(rows, summary?.as_of ?? new Date().toISOString().slice(0, 10));
      notify([{ tone: "info", title: `Exported ${plural(rows.length, noun)}` }]);
    },
    [summary?.as_of, notify],
  );
  const exportClaims = useCallback(() => exportRows(rowsFor(findings, "todo"), "open claim"), [exportRows, findings]);
  const goPage = useCallback((page: Page) => go({ page, params: {} }), [go]);

  // From the date menu, what changed shows as notices. From the keyboard nothing shows but the date: the
  // presenter cuts to "two weeks later" and asks the agent what came back.
  const advanceTime = (isQuiet = false) =>
    void act("advance", async () => {
      const before = findings;
      const result = await api.advance(ADVANCE_DAYS);
      if (isQuiet) return;
      const after = await api.findings();
      return advanceNotices(before, after, result.as_of).map((notice) => ({ ...notice, isResult: true }));
    });

  // Restart demo: the server goes back to its clean slate, the conversation starts over, and the Agent page opens.
  const restartDemo = async () => {
    if (busy) return;
    setBusy("restart");
    try {
      await demo.restart();
      setNotices([]);
      go({ page: "agent", params: {} });
    } catch (err) {
      notify([{ tone: "error", title: "The demo didn't restart", body: errorText(err) }]);
    } finally {
      setBusy(null);
    }
  };

  const sync = () =>
    void act("sync", async () => {
      try {
        const notice = syncNotice(await api.sync());
        return [{ tone: notice.ok ? "info" : "error", title: notice.title, body: notice.body }];
      } finally {
        await reloadSources();
      }
    });

  let page: React.ReactNode = null;
  if (error) {
    page = (
      <div role="alert" className="card px-5 py-4 text-14">
        {error}
      </div>
    );
  } else if (isLoading || !summary) {
    page = <p className="m-0 text-14 text-dim">Loading claims…</p>;
  } else if (route.page === "overview") {
    page = (
      <Overview
        summary={summary}
        findings={findings}
        onExport={exportClaims}
        onReview={() => go({ page: "claims", params: {} })}
      />
    );
  } else if (route.page === "claims" && caseId !== null) {
    page = caseError ? (
      <div className="card flex flex-col items-start gap-3 px-5 py-5 text-14">
        <p className="m-0">{caseError}</p>
        <a href={hrefFor({ page: "claims", params: writeParams(listParams.current) })} className="font-medium underline underline-offset-4">
          Back to claims
        </a>
      </div>
    ) : !detail ? (
      <p className="m-0 text-14 text-dim">Loading claim…</p>
    ) : (
      <CasePage
        key={detail.id}
        detail={detail}
        isDemo={summary.data_mode !== "live"}
        isBusy={busy === "case"}
        prevId={navIndex > 0 ? navIds[navIndex - 1] : null}
        nextId={navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null}
        position={navIndex >= 0 && inList ? { index: navIndex, total: navIds.length } : null}
        onNavigate={navigateCase}
        onBack={backToList}
        onDraft={() =>
          void act("case", async () => {
            // The draft appears in place; no notice needed.
            await api.draft(detail.id);
          })
        }
        onDismiss={(reason) =>
          void act("case", async () => {
            await api.dismiss(detail.id, reason);
            return [{ tone: "info", title: "Marked not owed" }];
          })
        }
        onSave={async (draftId, subject, body) => {
          const ok = await act("case", async () => {
            await api.editDraft(draftId, subject, body);
          });
          if (!ok) throw new Error("Couldn't save the draft.");
        }}
        onSend={async (draftId) => {
          const ok = await act("case", async () => {
            const sent = await api.send(draftId);
            return [
              {
                tone: "info",
                isResult: true,
                title: `${sent.channel === "card_dispute" ? "Dispute" : "Request"} sent to ${sent.to_addr}`,
                body: "It's under Waiting until the vendor replies.",
              },
            ];
          });
          if (!ok) throw new Error("Couldn't send.");
        }}
      />
    );
  } else if (route.page === "claims") {
    page = (
      <Claims
        findings={findings}
        params={claimsParams}
        onParams={(next) => replace({ page: "claims", params: writeParams(next) })}
        onOpen={openCase}
        onExport={(rows) => exportRows(rows)}
        isBusy={busy === "bulk"}
        onBulkDraft={(ids) =>
          act("bulk", async () => {
            await Promise.all(ids.map((id) => api.draft(id)));
            return [
              {
                tone: "info",
                title: ids.length === 1 ? "1 draft ready" : `${ids.length} drafts ready`,
                body: "Nothing was sent. Review each one before it goes.",
              },
            ];
          })
        }
        onBulkDismiss={(ids, reason) =>
          act("bulk", async () => {
            await Promise.all(ids.map((id) => api.dismiss(id, reason)));
            return [{ tone: "info", title: `${plural(ids.length, "claim")} marked not owed` }];
          })
        }
      />
    );
  } else if (route.page === "agent") {
    page = isDemoReady ? <Agent summary={summary} findings={findings} sources={sources} isHeld={busy !== null} /> : <p className="m-0 text-14 text-dim">Loading…</p>;
  } else if (route.page === "recovered") {
    page = <Recovered
        summary={summary}
        findings={findings}
        view={recoveredView(route.params)}
        onView={(view) => replace({ page: "recovered", params: view === "inflight" ? { view } : {} })}
        version={version}
        isAdvancing={busy === "advance"}
        onAdvance={() => advanceTime()}
        onExport={exportRows}
      />;
  } else if (route.page === "setup") {
    // Company onboarding (ledger, vendors, contracts). Reached at #/setup; it is not in the demo's navigation.
    page = (
      <Setup
        onDataChanged={() => {
          void reload();
          void reloadSources();
        }}
      />
    );
  } else {
    page = <SourcesPage sources={sources} isDemo={summary.demo_mode} isAvailable={sourcesAvailable} isSyncing={busy === "sync"} onSync={sync} />;
  }

  // The top bar title. A case shows where it sits: "Claims / Figma", with Claims back to the list.
  const caseMerchant = caseId !== null ? (detail?.id === caseId ? detail.merchant : findings.find((f) => f.id === caseId)?.merchant) : undefined;
  const title =
    caseId !== null ? (
      <span className="flex min-w-0 items-center gap-2">
        <a
          href={hrefFor({ page: "claims", params: writeParams(listParams.current) })}
          onClick={(e) => {
            e.preventDefault();
            backToList();
          }}
          className="flex-none rounded-xs text-dim transition-colors hover:text-ink"
        >
          Claims
        </a>
        <span aria-hidden className="flex-none text-line-strong">
          /
        </span>
        <span aria-current="page" className="truncate text-ink">
          {caseMerchant ? vendorName(caseMerchant) : "Claim"}
        </span>
      </span>
    ) : (
      PAGE_TITLE[route.page]
    );

  return (
    <MotionConfig reducedMotion="user">
      <Shell
        page={route.page}
        title={title}
        isBreadcrumb={caseId !== null}
        claimsCount={counts.todo}
        summary={summary}
        sources={sources}
        findings={findings}
        onExport={exportClaims}
        onOpenCase={openCase}
        onGo={goPage}
        isRunning={busy === "run"}
        isAdvancing={busy === "advance"}
        isRestarting={busy === "restart"}
        isLocked={demoBusy !== null}
        onAdvanceQuiet={() => advanceTime(true)}
        onRestart={() => void restartDemo()}
        onRun={() =>
          void act("run", async () => {
            const run = await api.runPipeline();
            return [
              {
                tone: "info",
                title: run.created ? `${plural(run.created, "new claim")} found` : "Nothing new found",
                body: `Read ${plural(run.emails_read, "email")} and the ledger.`,
              },
            ];
          })
        }
        onAdvance={() => advanceTime()}
      >
        {page}
      </Shell>
      <Notifications notices={notices} onDismiss={dismissNotice} />
    </MotionConfig>
  );
}
