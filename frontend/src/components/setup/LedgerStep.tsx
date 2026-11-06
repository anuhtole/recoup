import { useRef, useState } from "react";
import { api, type DateOrder, type LedgerImport, type LedgerPreview, type LedgerUpload } from "../../api";
import { formatMoney } from "../../format";
import { Button } from "../Button";
import { Field, INPUT, Problem, errorText } from "./shared";

/**
 * Upload a card or bank export. Recoup shows what it read first; nothing is stored until Import.
 * Re-importing the same file, or an overlapping one, is safe: rows already on file are skipped.
 */
export function LedgerUploader({ onImported }: { onImported: (result: LedgerImport) => void }) {
  const [upload, setUpload] = useState<LedgerUpload | null>(null);
  const [preview, setPreview] = useState<LedgerPreview | null>(null);
  const [result, setResult] = useState<LedgerImport | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setUpload(null);
    setPreview(null);
    // Lets the same file be picked again.
    if (fileInput.current) fileInput.current.value = "";
  };

  const run = async (next: LedgerUpload) => {
    setIsBusy(true);
    setProblem(null);
    setResult(null);
    try {
      setPreview(await api.previewLedger(next));
      setUpload(next);
    } catch (err) {
      setPreview(null);
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    void run({ filename: file.name, text: await readText(file) });
  };

  const doImport = async () => {
    if (!upload) return;
    setIsBusy(true);
    setProblem(null);
    try {
      const imported = await api.importLedger(upload);
      setResult(imported);
      reset();
      onImported(imported);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr] sm:items-end">
        <Field label="CSV export (Amex, Chase, Brex, QuickBooks, any bank)">
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="text-14" onChange={(e) => void choose(e.target.files?.[0])} />
        </Field>
        {upload && (
          <Field label="Account name (only if you upload exports from several cards)">
            <input
              className={INPUT}
              value={upload.account ?? ""}
              placeholder="e.g. amex-4242"
              onChange={(e) => setUpload({ ...upload, account: e.target.value })}
              onBlur={() => preview && void run(upload)}
            />
          </Field>
        )}
      </div>

      {preview && upload && <PreviewTable preview={preview} upload={upload} onChange={(next) => void run(next)} />}

      {preview && (
        <div className="flex gap-2">
          <Button variant="primary" isBusy={isBusy} disabled={preview.rows === 0} onClick={() => void doImport()}>
            Import {rows(preview.rows)} and look for leaks
          </Button>
          <Button variant="ghost" onClick={reset}>
            Cancel
          </Button>
        </div>
      )}

      {result && (
        <p className="text-14" role="status">
          Imported {result.inserted} new {result.inserted === 1 ? "row" : "rows"}
          {result.duplicates > 0 && `, ${rows(result.duplicates)} already imported`}
          {result.skipped_overlaps > 0 && `, ${rows(result.skipped_overlaps)} already on file from another source left out`}. Found{" "}
          {result.run.created} new {result.run.created === 1 ? "case" : "cases"}.
        </p>
      )}
      <Problem message={problem} />
    </div>
  );
}

const rows = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;

const MAPPABLE = ["date", "merchant", "amount", "debit", "credit", "reference", "id"] as const;

function PreviewTable({ preview, upload, onChange }: { preview: LedgerPreview; upload: LedgerUpload; onChange: (next: LedgerUpload) => void }) {
  const setColumn = (column: (typeof MAPPABLE)[number], header: string) => {
    // "" tells the server to ignore a column it would otherwise detect.
    const columns = { ...preview.columns, [column]: header };
    onChange({ ...upload, columns });
  };
  return (
    <div className="flex flex-col gap-3 text-14">
      <p>
        Read <strong>{rows(preview.rows)}</strong>
        {preview.first_date && ` from ${preview.first_date} to ${preview.last_date}`}, {formatMoney(preview.charges_minor)} in charges.
        {preview.skipped > 0 && ` Skipped ${rows(preview.skipped)} that could not be read.`}
      </p>
      {(preview.already_imported > 0 || preview.on_file_elsewhere > 0) && (
        <p className="text-dim">
          {preview.already_imported > 0 && `${rows(preview.already_imported)} imported before will be skipped. `}
          {preview.on_file_elsewhere > 0 &&
            `${rows(preview.on_file_elsewhere)} matching charges already on file from another source will be left out, so they are not mistaken for duplicate charges.`}
        </p>
      )}
      {(!preview.is_sign_certain || !preview.is_date_order_certain) && (
        <p className="text-amber" role="alert">
          Check {!preview.is_sign_certain && "whether charges are positive or negative"}
          {!preview.is_sign_certain && !preview.is_date_order_certain && " and "}
          {!preview.is_date_order_certain && "the date order"} below: this file does not make it clear.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {MAPPABLE.map((column) => (
          <Field key={column} label={column}>
            <select className={INPUT} value={preview.columns[column] ?? ""} onChange={(e) => setColumn(column, e.target.value)}>
              <option value="">(none)</option>
              {preview.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="Charges are">
          <select
            className={INPUT}
            value={preview.charge_sign}
            onChange={(e) => onChange({ ...upload, charge_sign: e.target.value as "positive" | "negative" })}
          >
            <option value="positive">positive amounts</option>
            <option value="negative">negative amounts</option>
          </select>
        </Field>
        <Field label="Dates are">
          <select
            className={INPUT}
            value={preview.date_order}
            onChange={(e) => onChange({ ...upload, date_order: e.target.value as DateOrder })}
          >
            <option value="month_first">month first (09/03)</option>
            <option value="day_first">day first (03/09)</option>
          </select>
        </Field>
      </div>
      {preview.problems.length > 0 && (
        <ul className="list-disc pl-5 text-amber">
          {preview.problems.map((p) => (
            <li key={p.line}>
              Line {p.line}: {p.reason}
            </li>
          ))}
        </ul>
      )}
      <table className="w-full text-left">
        <thead className="text-dim">
          <tr>
            <th className="py-1 font-normal">Date</th>
            <th className="py-1 font-normal">Merchant</th>
            <th className="py-1 text-right font-normal">Amount</th>
            <th className="py-1 font-normal">Reference</th>
          </tr>
        </thead>
        <tbody>
          {preview.sample.map((t) => (
            <tr key={t.external_id} className="border-t border-line">
              <td className="py-1">{t.posted_at.slice(0, 10)}</td>
              <td className="py-1">{t.merchant}</td>
              <td className="py-1 text-right tabular-nums">{formatMoney(t.amount_minor, t.currency)}</td>
              <td className="py-1 text-dim">{t.reference ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The file as text: UTF-8 when it is, otherwise Windows-1252, which older bank exports use. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
