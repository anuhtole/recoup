import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Finding } from "./api";
import { Shell } from "./components/shell/Shell";
import { syncNotice } from "./components/Sources";
import { type Notice, Notifications } from "./components/Toast";
import { formatDate, formatMoney, plural, setReferenceYear } from "./format";
import { useCase } from "./hooks/useCase";
import { useCases } from "./hooks/useCases";
import { hrefFor, useHashRoute } from "./hooks/useHashRoute";
import { useSources } from "./hooks/useSources";
import { downloadClaims } from "./lib/exportCsv";
import { vendorName } from "./lib/vendors";
import { CasePage } from "./pages/Case";
import { Claims, type ClaimsParams, readParams, visibleIds, writeParams } from "./pages/Claims";
import { Overview } from "./pages/Overview";
import type { Page } from "./hooks/useHashRoute";
import { Recovered } from "./pages/Recovered";
import { SourcesPage } from "./pages/SourcesPage";
import { countsFor, rowsFor, tabOf } from "./queue";

const ADVANCE_DAYS = 14;

const PAGE_TITLE: Record<Page, string> = { overview: "Overview", claims: "Claims", recovered: "Recovered", sources: "Sources" };

type NoticeInput = Omit<Notice, "id">;
type Busy = "case" | "run" | "advance" | "sync" | "bulk" | null;

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // fetch rejects with a TypeError when the server can't be reached at all.
  if (error instanceof TypeError) return "Couldn't reach the Recoup server. Check that it's running and try again.";
  return "Something went wrong. Check the API logs.";
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
  if (created > 0) notices.push({ tone: "info", title: created === 1 ? "1 new case found" : `${created} new cases found` });
  if (notices.length === 0) notices.push({ tone: "info", title: `Now ${formatDate(asOf)}`, body: "No vendor replies or credits in these two weeks." });
  return notices;
}

export function App() {
  const { summary, findings, error, isLoading, reload } = useCases();
  const { route, go, replace } = useHashRoute();
  const { sources, isAvailable: sourcesAvailable, reload: reloadSources } = useSources();
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
    await reload();
    setVersion((v) => v + 1);
  }, [reload]);

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
      notify([{ tone: "error", title: kind === "sync" ? "Sync didn't finish" : "That did not go through", body: errorText(err) }]);
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

  // Export: the open claims (To do), as CSV built in the browser.
  const exportClaims = useCallback(() => {
    const rows = rowsFor(findings, "todo");
    downloadClaims(rows, summary?.as_of ?? new Date().toISOString().slice(0, 10));
    notify([{ tone: "info", title: `Exported ${plural(rows.length, "open claim")}`, body: "Saved as a CSV file." }]);
  }, [findings, summary?.as_of, notify]);
  const goPage = useCallback((page: Page) => go({ page, params: {} }), [go]);

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
    page = <p className="m-0 text-14 text-dim">Loading cases…</p>;
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
      <p className="m-0 text-14 text-dim">Loading case…</p>
    ) : (
      <CasePage
        key={detail.id}
        detail={detail}
        isBusy={busy === "case"}
        listHref={hrefFor({ page: "claims", params: writeParams(listParams.current) })}
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
                body: "The case is now under Waiting until the vendor replies.",
              },
            ];
          });
          if (!ok) throw new Error("Could not send.");
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
        isBusy={busy === "bulk"}
        onBulkDraft={(ids) =>
          act("bulk", async () => {
            await Promise.all(ids.map((id) => api.draft(id)));
            return [
              {
                tone: "info",
                title: ids.length === 1 ? "1 draft ready" : `${ids.length} drafts ready`,
                body: "Nothing was sent. Open each case to review and approve it.",
              },
            ];
          })
        }
        onBulkDismiss={(ids, reason) =>
          act("bulk", async () => {
            await Promise.all(ids.map((id) => api.dismiss(id, reason)));
            return [{ tone: "info", title: `${plural(ids.length, "case")} dismissed`, body: "The reason is kept in each history." }];
          })
        }
      />
    );
  } else if (route.page === "recovered") {
    page = <Recovered summary={summary} findings={findings} version={version} />;
  } else {
    page = <SourcesPage sources={sources} isAvailable={sourcesAvailable} isSyncing={busy === "sync"} onSync={sync} />;
  }

  // The top bar title. A case shows where it sits: "Claims / Figma", with Claims back to the list.
  const caseMerchant = caseId !== null ? (detail?.id === caseId ? detail.merchant : findings.find((f) => f.id === caseId)?.merchant) : undefined;
  const title =
    caseId !== null ? (
      <span className="flex min-w-0 items-baseline gap-2">
        <a href={hrefFor({ page: "claims", params: writeParams(listParams.current) })} className="flex-none text-dim transition-colors hover:text-ink">
          Claims
        </a>
        <span aria-hidden className="flex-none text-line-strong">
          /
        </span>
        <span className="truncate">{caseMerchant ? vendorName(caseMerchant) : "Case"}</span>
      </span>
    ) : (
      PAGE_TITLE[route.page]
    );

  return (
    <MotionConfig reducedMotion="user">
      <Shell
        page={route.page}
        title={title}
        claimsCount={counts.todo}
        summary={summary}
        sources={sources}
        findings={findings}
        onExport={exportClaims}
        onOpenCase={openCase}
        onGo={goPage}
        isRunning={busy === "run"}
        isAdvancing={busy === "advance"}
        onRun={() =>
          void act("run", async () => {
            const run = await api.runPipeline();
            return [
              {
                tone: "info",
                title: run.created ? `${plural(run.created, "new case")} found` : "Nothing new found",
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
            return advanceNotices(before, after, result.as_of).map((notice) => ({ ...notice, isResult: true }));
          })
        }
      >
        {page}
      </Shell>
      <Notifications notices={notices} onDismiss={dismissNotice} />
    </MotionConfig>
  );
}
