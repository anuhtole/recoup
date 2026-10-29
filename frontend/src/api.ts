// Types mirror backend/src/recoup/api/schemas.py.

export type Outcome = "recoverable" | "not_recoverable" | "needs_review";
export type LeakType =
  | "duplicate_charge"
  | "missing_refund"
  | "charged_after_cancellation"
  | "sla_credit";
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
  claimable_minor: number;
  in_flight_minor: number;
  recovered_minor: number;
  expired_minor: number;
  stages: { stage: Stage; count: number }[];
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
};
