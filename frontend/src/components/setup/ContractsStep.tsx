import { useEffect, useState } from "react";
import { api, type Contract, type StoredContract } from "../../api";
import { Button } from "../Button";
import { Field, INPUT, Problem, errorText, fileBase64 } from "./shared";

const MAX_DOCUMENT_BYTES = 10_000_000;

/**
 * Contracts: Claude reads an uploaded order form or MSA and proposes terms, which only
 * count once a person has looked at them and saved. Terms can also be typed in directly.
 */
export function ContractsEditor({ onChanged }: { onChanged: () => void }) {
  const [contracts, setContracts] = useState<StoredContract[]>([]);
  const [terms, setTerms] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async () => {
    try {
      setContracts(await api.contracts());
    } catch (err) {
      setProblem(errorText(err));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      setProblem("That file is over 10 MB.");
      return;
    }
    setIsBusy(true);
    setProblem(null);
    try {
      const result = await api.readContract(file.name, await fileBase64(file));
      setNotes(result.problems);
      if (result.contract) setTerms(JSON.stringify(result.contract, null, 2));
      else setProblem("Recoup could not find terms it can stand behind in that document.");
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  const save = async () => {
    if (terms === null) return;
    let contract: Contract;
    try {
      contract = JSON.parse(terms) as Contract;
    } catch {
      setProblem("The terms are not valid JSON.");
      return;
    }
    setIsBusy(true);
    setProblem(null);
    try {
      await api.saveContract(contract);
      setTerms(null);
      setNotes([]);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.removeContract(id);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 text-14">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Order form or MSA (PDF or text). Claude reads it; you confirm.">
          <input type="file" accept=".pdf,.txt,.md" className="text-14" disabled={isBusy} onChange={(e) => void read(e.target.files?.[0])} />
        </Field>
        <Button size="sm" variant="ghost" onClick={() => setTerms(JSON.stringify(BLANK, null, 2))}>
          Type terms instead
        </Button>
      </div>
      {isBusy && terms === null && <p className="text-dim">Reading the document…</p>}

      {terms !== null && (
        <div className="flex flex-col gap-2">
          {notes.length > 0 && (
            <ul className="list-disc pl-5 text-amber">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <Field label="Check these terms against the document before saving (basis points: 99.9% = 9990)">
            <textarea className={`${INPUT} h-72 py-2 font-mono text-12`} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" isBusy={isBusy} onClick={() => void save()}>
              Save contract
            </Button>
            <Button variant="ghost" onClick={() => setTerms(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <Problem message={problem} />

      <details>
        <summary className="cursor-pointer text-dim">Contracts on file ({contracts.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {contracts.map((c) => (
            <li key={`${c.vendor_key}:${c.plan}`} className="flex items-center justify-between gap-3 border-t border-line py-1">
              <span>
                {c.vendor_key} · {c.plan}{" "}
                <span className="text-dim">
                  {c.sla_target_bp !== null && `· SLA ${(c.sla_target_bp / 100).toFixed(2)}%`}
                  {c.price_minor !== null && ` · price ${(c.price_minor / 100).toFixed(2)} ${c.price_currency}`} · {c.origin}
                </span>
              </span>
              {c.id !== null && (
                <Button size="sm" variant="ghost" onClick={() => void remove(c.id as number)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const BLANK: Contract = {
  vendor_key: "",
  plan: "",
  document: "",
  sla_target_bp: null,
  tiers: [],
  claim_window_days: 30,
  clause: "",
  period: "month",
  covered_components: [],
  needs_customer_confirmation: false,
  price_minor: null,
  price_currency: "USD",
  price_locked_until: null,
  price_increase_cap_bp: null,
  price_clause: "",
};
