import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button } from "../Button";
import { Field, INPUT, Problem, errorText } from "./shared";

export function CompanyForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [disputes, setDisputes] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api
      .company()
      .then((c) => {
        setName(c.is_set ? c.name : "");
        setDisputes(c.card_dispute_address);
      })
      .catch((err: unknown) => setProblem(errorText(err)));
  }, []);

  const save = async () => {
    setIsBusy(true);
    setProblem(null);
    try {
      await api.saveCompany(name, disputes);
      onSaved();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Company name (drafts are signed “<name> Finance”)">
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" required />
      </Field>
      <Field label="Card dispute address (your card issuer)">
        <input className={INPUT} type="email" value={disputes} onChange={(e) => setDisputes(e.target.value)} required />
      </Field>
      <Button type="submit" variant="primary" isBusy={isBusy}>
        Save
      </Button>
      <div className="sm:col-span-3">
        <Problem message={problem} />
      </div>
    </form>
  );
}
