import { useCallback, useEffect, useState } from "react";
import { api, type Setup as SetupState, type SetupStepKey } from "../../api";
import { CompanyForm } from "./CompanyStep";
import { ContractsEditor } from "./ContractsStep";
import { LedgerUploader } from "./LedgerStep";
import { Problem, Step, errorText } from "./shared";
import { VendorsEditor } from "./VendorsStep";

const TITLES: Record<SetupStepKey, string> = {
  company: "Your company",
  ledger: "Ledger",
  vendors: "Vendors",
  mail: "Finance inbox",
  contracts: "Contracts",
};

/** What the Gmail callback left in the hash: #/setup?gmail=connected or ?gmail=error&reason=... */
function gmailResult(): { ok: boolean; reason: string | null } | null {
  const query = window.location.hash.split("?")[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  const gmail = params.get("gmail");
  if (gmail === null) return null;
  return { ok: gmail === "connected", reason: params.get("reason") };
}

/** Plug one company's data into Recoup, in the order that makes the next step useful. */
export function Setup({ onDataChanged }: { onDataChanged: () => void }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gmail] = useState(gmailResult);

  const reload = useCallback(async () => {
    try {
      setState(await api.setup());
    } catch (err) {
      setProblem(errorText(err));
    }
  }, []);
  useEffect(() => {
    void reload();
    // Drop the one-time ?gmail=... so a refresh doesn't show it again.
    if (gmail) window.history.replaceState(null, "", "#/setup");
  }, [reload, gmail]);

  const changed = () => {
    void reload();
    onDataChanged();
  };

  if (!state) return problem ? <Problem message={problem} /> : <p className="text-14 text-dim">Loading setup…</p>;

  const panels: Record<SetupStepKey, JSX.Element> = {
    company: <CompanyForm onSaved={changed} />,
    ledger: (
      <div className="flex flex-col gap-3">
        <p className="text-14 text-dim">
          {state.counts.transactions} transactions on file.
          {state.connections.ramp ? " Ramp is connected and syncs on its own." : " Ramp customers can connect with an API client instead (see Sources)."}
        </p>
        <LedgerUploader onImported={changed} />
      </div>
    ),
    // Remount when new ledger rows or mail arrive, so the suggestions reflect them.
    vendors: <VendorsEditor key={`${state.counts.transactions}:${state.counts.emails}`} onChanged={changed} />,
    mail: <MailStep state={state} gmail={gmail} />,
    contracts: <ContractsEditor onChanged={changed} />,
  };

  const left = state.steps.filter((s) => !s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-26 font-semibold">Set up Recoup</h1>
        <p className="text-14 text-dim">
          {left === 0 ? "Everything is connected. Recoup checks for leaks on every sync." : `${left} of ${state.steps.length} steps left.`}
          {state.data_mode === "demo" && " You are looking at the demo company; what you add here is stored alongside it."}
        </p>
      </header>
      {state.steps.map((step, i) => (
        <Step key={step.key} n={i + 1} title={TITLES[step.key]} done={step.done} hint={step.hint}>
          {panels[step.key]}
        </Step>
      ))}
    </div>
  );
}

function MailStep({ state, gmail }: { state: SetupState; gmail: { ok: boolean; reason: string | null } | null }) {
  return (
    <div className="flex flex-col gap-2 text-14">
      {gmail && (
        <p role="status" className={gmail.ok ? "text-money-ink" : "text-amber"}>
          {gmail.ok ? "Gmail is connected. Recoup reads it on the next sync." : `Gmail was not connected: ${gmail.reason ?? "try again."}`}
        </p>
      )}
      <p className="text-dim">
        {state.counts.emails} emails read so far. Recoup asks for read-only access: it never sends from your inbox, and
        drafts wait in its outbox until you approve them.
      </p>
      {state.connections.gmail ? (
        <p>Connected.</p>
      ) : state.connections.gmail_can_connect ? (
        // A full-page visit: the server redirects to Google and back to #/setup.
        <a href="/api/connect/gmail" className="w-fit rounded-row bg-primary px-4 py-2 text-on-primary hover:bg-primary-hover">
          Connect Gmail
        </a>
      ) : (
        <p className="text-dim">
          To connect Gmail, set RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET on the server (a Google OAuth
          client), then reload this page.
        </p>
      )}
    </div>
  );
}
