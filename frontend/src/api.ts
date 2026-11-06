// Types mirror backend/src/recoup/api/schemas.py.

export type Outcome = "recoverable" | "not_recoverable" | "needs_review";
export type LeakType =
  | "duplicate_charge"
  | "missing_refund"
  | "charged_after_cancellation"
  | "sla_credit"
  | "price_overcharge";
export type Status =
  | "open"
  | "drafted"
  | "sent"
  | "vendor_agreed"
  | "info_requested"
  | "vendor_declined"
  | "recovered"
  | "dismissed"
  | "expired";
export type Stage = "todo" | "waiting" | "done";
export type ActionKind = "draft" | "review" | "follow_up" | "escalate" | "wait" | "none";

export interface NextAction {
  kind: ActionKind;
  label: string;
}

export interface Finding {
  id: number;
  leak_type: LeakType;
  outcome: Outcome;
  status: Status;
  stage: Stage;
  merchant: string;
  amount_minor: number;
  currency: string;
  reason: string;
  recover_by: string | null;
  days_left: number | null;
  recovered_minor: number | null;
  detector_version: string;
  transaction_ids: string[];
  source_refs: string[];
  next_action: NextAction;
  created_at: string;
}

export type EvidenceKind = "transaction" | "email" | "contract" | "incident" | "rule" | "note";

export interface Evidence {
  kind: EvidenceKind;
  ref: string;
  detail: string;
}

export interface Transaction {
  id: string;
  posted_at: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  reference: string | null;
  card_last4: string | null;
}

export interface Email {
  id: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  sent_at: string;
  body: string;
  in_reply_to: string | null;
}

export interface Draft {
  id: number;
  channel: "vendor_email" | "card_dispute";
  to_addr: string;
  subject: string;
  body: string;
  drafter: string;
  status: "draft" | "sent";
  sent_at: string | null;
  sent_by: string | null;
}

export type TimelineKind =
  | "charge"
  | "promise"
  | "incident"
  | "detected"
  | "drafted"
  | "sent"
  | "reply"
  | "recovered"
  | "dismissed"
  | "deadline";

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  is_future: boolean;
}

export interface AuditEvent {
  id: number;
  occurred_at: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface FindingDetail extends Finding {
  evidence: Evidence[];
  transactions: Transaction[];
  emails: Email[];
  drafts: Draft[];
  timeline: TimelineEvent[];
  trace: AuditEvent[];
}

export interface Summary {
  currency: string;
  as_of: string;
  mode: string;
  demo_mode: boolean;
  /** "demo" for the generated world, "live" for data that arrived by sync. Older APIs omit it. */
  data_mode?: "demo" | "live";
  claimable_minor: number;
  in_flight_minor: number;
  recovered_minor: number;
  expired_minor: number;
  stages: { stage: Stage; count: number }[];
}

// GET /api/sources: where each source stands. Credentials never appear here.
export interface SyncRun {
  ok: boolean;
  origin: string;
  finished_at: string;
  detail: Record<string, unknown> | null;
}

export type ConnectorKind = "ledger" | "email" | "status";

export interface Sources {
  ramp: { connected: boolean; environment: string; last_sync: SyncRun | null };
  gmail: { connected: boolean; last_sync: SyncRun | null };
  connectors: { key: string; kind: ConnectorKind; configured: boolean; last_sync: SyncRun | null }[];
  background_sync: { interval_minutes: number; running: boolean; last_finished_at: string | null; last_error: string | null };
  status_feeds: { key: string; page_url: string; sla: string; last_sync: SyncRun | null }[];
}

// POST /api/sync: every connected source, then detection.
export interface SyncReport {
  finished_at: string;
  outcomes: { connector: string; kind: ConnectorKind; ok: boolean; detail: Record<string, unknown> | null; error: string | null }[];
  run: RunSummary;
}

export interface RunSummary {
  as_of: string;
  emails_read: number;
  promises: number;
  rejected: number;
  replies: number;
  created: number;
  updated: number;
  unchanged: number;
  recovered: number;
}

export interface AdvanceResult {
  previous_as_of: string;
  as_of: string;
  replies: number;
  credits: number;
  run: RunSummary;
}

// Setup: plugging one company's data into Recoup. Mirrors api/routes/{company,ledger,discovery}.py.
export type SetupStepKey = "company" | "ledger" | "vendors" | "mail" | "contracts";

export interface Setup {
  data_mode: "demo" | "live";
  counts: { transactions: number; emails: number; vendors: number; contracts: number };
  connections: { ramp: boolean; gmail: boolean; gmail_can_connect: boolean };
  steps: { key: SetupStepKey; done: boolean; hint: string }[];
}

export interface Company {
  name: string;
  card_dispute_address: string;
  is_set: boolean;
}

export interface Vendor {
  key: string;
  name: string;
  support_email: string;
  domains: string[];
  aliases: string[];
  origin: "bundled" | "user" | "discovered";
}

export interface VendorSuggestion {
  merchant: string;
  key: string;
  name: string;
  charges: number;
  spend_minor: number;
  domains: string[];
  senders: string[];
}

export interface SlaTier {
  below_bp: number;
  credit_pct: number;
}

export interface Contract {
  vendor_key: string;
  plan: string;
  document: string;
  sla_target_bp: number | null;
  tiers: SlaTier[];
  claim_window_days: number;
  clause: string;
  period: "month" | "quarter";
  covered_components: string[];
  needs_customer_confirmation: boolean;
  price_minor: number | null;
  price_currency: string;
  price_locked_until: string | null;
  price_increase_cap_bp: number | null;
  price_clause: string;
}

export interface StoredContract extends Contract {
  id: number | null;
  origin: "bundled" | "user" | "upload";
}

export type LedgerColumn = "date" | "merchant" | "amount" | "debit" | "credit" | "currency" | "reference" | "id" | "card";

export interface LedgerUpload {
  filename: string;
  text: string;
  // Only needed when exports from several cards or accounts lack an id column.
  account?: string;
  // An empty string means "this file has no such column".
  columns?: Partial<Record<LedgerColumn, string>>;
  charge_sign?: "positive" | "negative";
  date_order?: DateOrder;
  currency?: string;
  include_overlaps?: boolean;
}

export type DateOrder = "month_first" | "day_first";

export interface LedgerPreview {
  headers: string[];
  columns: Partial<Record<LedgerColumn, string>>;
  charge_sign: "positive" | "negative";
  // False when Recoup guessed from weak evidence and a person should check.
  is_sign_certain: boolean;
  date_order: DateOrder;
  is_date_order_certain: boolean;
  already_imported: number;
  // Rows another source (Ramp, an earlier upload) already holds.
  on_file_elsewhere: number;
  rows: number;
  skipped: number;
  problems: { line: number; reason: string }[];
  first_date: string | null;
  last_date: string | null;
  charges_minor: number;
  sample: (Transaction & { source: string; external_id: string })[];
}

export interface LedgerImport {
  source: string;
  inserted: number;
  duplicates: number;
  skipped_overlaps: number;
  run: RunSummary;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  summary: () => request<Summary>("/api/summary"),
  findings: () => request<Finding[]>("/api/findings"),
  finding: (id: number) => request<FindingDetail>(`/api/findings/${id}`),
  draft: (id: number) => post<Draft>(`/api/findings/${id}/draft`),
  dismiss: (id: number, reason: string) => post<Finding>(`/api/findings/${id}/dismiss`, { reason }),
  editDraft: (id: number, subject: string, body: string) =>
    request<Draft>(`/api/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ subject, body }),
    }),
  // Only ever called from the confirmation dialog: confirm=true is the human approval.
  send: (id: number) => post<Draft>(`/api/drafts/${id}/send`, { confirm: true }),
  runPipeline: () => post<RunSummary>("/api/pipeline/run"),
  advance: (days: number) => post<AdvanceResult>("/api/demo/advance", { days }),
  sources: () => request<Sources>("/api/sources"),
  sync: () => post<SyncReport>("/api/sync"),

  setup: () => request<Setup>("/api/setup"),
  company: () => request<Company>("/api/company"),
  saveCompany: (name: string, card_dispute_address: string) =>
    request<Company>("/api/company", { method: "PUT", body: JSON.stringify({ name, card_dispute_address }) }),
  previewLedger: (upload: LedgerUpload) => post<LedgerPreview>("/api/ledger/preview", upload),
  importLedger: (upload: LedgerUpload) => post<LedgerImport>("/api/ledger/import", upload),
  vendors: () => request<Vendor[]>("/api/vendors"),
  vendorSuggestions: () => request<VendorSuggestion[]>("/api/vendors/suggestions"),
  // `merchant` is the name as the ledger prints it; the server derives the key.
  saveVendor: (merchant: string, vendor: Pick<Vendor, "name" | "support_email" | "domains" | "aliases">, origin: "user" | "discovered") =>
    request<Vendor>(`/api/vendors/${encodeURIComponent(merchant)}`, {
      method: "PUT",
      body: JSON.stringify({ ...vendor, origin }),
    }),
  removeVendor: (key: string) => request<{ removed: boolean }>(`/api/vendors/${encodeURIComponent(key)}`, { method: "DELETE" }),
  contracts: () => request<StoredContract[]>("/api/contracts"),
  // Claude reads the document; nothing is stored until saveContract.
  readContract: (filename: string, data_base64: string) =>
    post<{ contract: Contract | null; problems: string[] }>("/api/contracts/read", { filename, data_base64 }),
  saveContract: (contract: Contract) => post<StoredContract>("/api/contracts", contract),
  removeContract: (id: number) => request<{ removed: boolean }>(`/api/contracts/${id}`, { method: "DELETE" }),
};
