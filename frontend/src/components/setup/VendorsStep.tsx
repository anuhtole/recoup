import { useEffect, useState } from "react";
import { api, type Vendor, type VendorSuggestion } from "../../api";
import { formatMoney } from "../../format";
import { Button } from "../Button";
import { Field, INPUT, Problem, errorText } from "./shared";

interface Draft {
  merchant: string;
  name: string;
  support_email: string;
  domains: string;
  origin: "user" | "discovered";
}

const EMPTY: Draft = { merchant: "", name: "", support_email: "", domains: "", origin: "user" };

function fromSuggestion(s: VendorSuggestion): Draft {
  return {
    merchant: s.merchant,
    name: s.name,
    // Never prefilled from mail: who to write to is the person's call.
    support_email: "",
    domains: s.domains.join(", "),
    origin: "discovered",
  };
}

/**
 * Who Recoup writes to for each merchant. Suggestions come from ledger merchants Recoup
 * does not know yet; the address to write to is always typed or confirmed by a person.
 */
export function VendorsEditor({ onChanged }: { onChanged: () => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [suggestions, setSuggestions] = useState<VendorSuggestion[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async () => {
    try {
      const [v, s] = await Promise.all([api.vendors(), api.vendorSuggestions()]);
      setVendors(v);
      setSuggestions(s);
    } catch (err) {
      setProblem(errorText(err));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (d: Draft) => {
    setIsBusy(true);
    setProblem(null);
    try {
      const domains = d.domains.split(/[\s,]+/).filter(Boolean);
      await api.saveVendor(d.merchant, { name: d.name, support_email: d.support_email, domains, aliases: [] }, d.origin);
      setDraft(null);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async (key: string) => {
    try {
      await api.removeVendor(key);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 text-14">
      {suggestions.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium">On your ledger, not set up yet</h3>
          <ul className="flex flex-col gap-1">
            {suggestions.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 rounded-row bg-tint px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>{" "}
                  <span className="text-dim">
                    {s.charges} charges, {formatMoney(s.spend_minor)}
                    {s.domains.length > 0 && ` · mail from ${s.domains.join(", ")}`}
                  </span>
                </span>
                <Button size="sm" onClick={() => setDraft(fromSuggestion(s))}>
                  Set up
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft ? (
        <form
          className="grid gap-3 rounded-row bg-tint p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <Field label="Merchant, as the ledger prints it">
            <input className={INPUT} value={draft.merchant} onChange={(e) => setDraft({ ...draft, merchant: e.target.value })} required />
          </Field>
          <Field label="Vendor name">
            <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </Field>
          <Field label="Billing or support address Recoup writes to">
            <input
              className={INPUT}
              type="email"
              value={draft.support_email}
              onChange={(e) => setDraft({ ...draft, support_email: e.target.value })}
              placeholder="billing@vendor.com"
              required
            />
          </Field>
          <Field label="Domains their mail comes from (comma separated)">
            <input className={INPUT} value={draft.domains} onChange={(e) => setDraft({ ...draft, domains: e.target.value })} required />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" isBusy={isBusy}>
              Save vendor
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" onClick={() => setDraft(EMPTY)}>
            Add a vendor
          </Button>
        </div>
      )}
      <Problem message={problem} />

      <details>
        <summary className="cursor-pointer text-dim">Known vendors ({vendors.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {vendors.map((v) => (
            <li key={v.key} className="flex items-center justify-between gap-3 border-t border-line py-1">
              <span>
                {v.name} <span className="text-dim">· {v.support_email} · {v.origin}</span>
              </span>
              {v.origin !== "bundled" && (
                <Button size="sm" variant="ghost" onClick={() => void remove(v.key)}>
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
