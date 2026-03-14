import type {
  Claim,
  ClaimStatus,
  EventType,
  EventSourceKind,
  EventTrustLevel,
  NormalizedEvent,
  Outcome,
  OutcomeType,
  ResolutionRule,
  VerificationStatus,
} from "./types.js";

const CLAIM_TYPES = new Set(["fact", "decision", "thread"]);
const ASSERTION_KINDS = new Set([
  "fact",
  "hypothesis",
  "instruction",
  "preference",
  "todo",
  "outcome",
]);
const CARDINALITIES = new Set(["singleton", "set"]);
const VERIFICATION_STATUSES = new Set([
  "unverified",
  "inferred",
  "user_confirmed",
  "system_verified",
  "outcome_verified",
  "disputed",
]);
const CLAIM_STATUSES = new Set(["active", "stale", "superseded", "archived"]);
const THREAD_STATUSES = new Set(["open", "resolved", "blocked"]);
const OUTCOME_TYPES = new Set([
  "test_pass",
  "test_fail",
  "build_pass",
  "build_fail",
  "commit_kept",
  "commit_reverted",
  "issue_closed",
  "issue_reopened",
  "human_kept",
  "human_corrected",
  "manual_override",
]);
const EVENT_TYPES = new Set([
  "user_message",
  "agent_message",
  "file_edit",
  "command_result",
  "test_result",
  "build_result",
  "lint_result",
  "benchmark_result",
  "deploy_result",
  "git_commit",
  "git_revert",
  "pr_opened",
  "pr_merged",
  "pr_closed",
  "issue_link",
  "issue_closed",
  "issue_reopened",
  "human_edit_after_agent",
  "manual_override",
  "session_start",
  "session_end",
  "user_confirmation",
]);
const EVENT_SOURCE_KINDS = new Set(["user", "agent", "system", "operator", "imported"]);
const EVENT_TRUST_LEVELS = new Set(["low", "medium", "high"]);
const ALLOWED_STATUS_TRANSITIONS: Record<ClaimStatus, Set<ClaimStatus>> = {
  active: new Set(["stale", "superseded", "archived"]),
  stale: new Set(["active", "superseded", "archived"]),
  superseded: new Set(["archived"]),
  archived: new Set(["active"]),
};

export class RuntimeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeInvariantError";
  }
}

function assertEnumValue<T extends string>(
  value: string,
  allowed: Set<string>,
  label: string
): asserts value is T {
  if (!allowed.has(value)) {
    throw new RuntimeInvariantError(`invalid ${label}: ${value}`);
  }
}

function assertRange(value: number, min: number, max: number, label: string): void {
  if (Number.isNaN(value) || value < min || value > max) {
    throw new RuntimeInvariantError(`${label} must be between ${min} and ${max}`);
  }
}

export function assertEventType(eventType: string): asserts eventType is EventType {
  assertEnumValue<EventType>(eventType, EVENT_TYPES, "event_type");
}

export function assertVerificationStatus(
  status: string
): asserts status is VerificationStatus {
  assertEnumValue<VerificationStatus>(
    status,
    VERIFICATION_STATUSES,
    "verification_status"
  );
}

export function assertOutcomeType(outcomeType: string): asserts outcomeType is OutcomeType {
  assertEnumValue<OutcomeType>(outcomeType, OUTCOME_TYPES, "outcome_type");
}

export function assertClaimTransitionAllowed(
  fromStatus: ClaimStatus,
  toStatus: ClaimStatus,
  reason: string
): void {
  if (fromStatus === toStatus) return;
  if (!ALLOWED_STATUS_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw new RuntimeInvariantError(
      `illegal claim status transition: ${fromStatus} -> ${toStatus} (${reason})`
    );
  }
}

export function validateClaimRecord(claim: Claim): void {
  assertEnumValue(claim.type, CLAIM_TYPES, "claim.type");
  assertEnumValue(claim.assertion_kind, ASSERTION_KINDS, "claim.assertion_kind");
  assertEnumValue(claim.cardinality, CARDINALITIES, "claim.cardinality");
  assertVerificationStatus(claim.verification_status);
  assertEnumValue(claim.status, CLAIM_STATUSES, "claim.status");
  if (claim.thread_status) {
    assertEnumValue(claim.thread_status, THREAD_STATUSES, "claim.thread_status");
  }

  assertRange(claim.confidence, 0, 1, "claim.confidence");
  assertRange(claim.importance, 0, 1, "claim.importance");
  assertRange(claim.outcome_score, -1, 1, "claim.outcome_score");

  if (!Array.isArray(claim.source_event_ids) || claim.source_event_ids.length === 0) {
    throw new RuntimeInvariantError("claim.source_event_ids must contain at least one event id");
  }

  if (claim.verification_status === "disputed" && claim.status === "active") {
    throw new RuntimeInvariantError("disputed claims must not remain active");
  }

  if (claim.type !== "thread" && claim.thread_status) {
    throw new RuntimeInvariantError("non-thread claims must not set thread_status");
  }

  if (claim.thread_status === "resolved" && claim.status !== "archived") {
    throw new RuntimeInvariantError("resolved threads must be archived");
  }

  if (claim.type !== "thread" && claim.resolved_at) {
    throw new RuntimeInvariantError("non-thread claims must not set resolved_at");
  }
}

export function validateOutcomeRecord(outcome: Outcome): void {
  assertOutcomeType(outcome.outcome_type);
  assertRange(outcome.strength, 0, 1, "outcome.strength");
  if (!Array.isArray(outcome.related_event_ids) || outcome.related_event_ids.length === 0) {
    throw new RuntimeInvariantError("outcome.related_event_ids must contain at least one event id");
  }
}

export function validateEventRecord(event: NormalizedEvent): void {
  assertEventType(event.event_type);
  if (event.source_kind) {
    assertEnumValue<EventSourceKind>(event.source_kind, EVENT_SOURCE_KINDS, "source_kind");
  }
  if (event.trust_level) {
    assertEnumValue<EventTrustLevel>(event.trust_level, EVENT_TRUST_LEVELS, "trust_level");
  }
}

export function isExplicitVerificationStatus(
  status: VerificationStatus
): boolean {
  return status === "system_verified" || status === "user_confirmed";
}

export function familyHintAllowedForEvent(
  family:
    | "current_strategy"
    | "blocker"
    | "rejected_strategy"
    | "open_question",
  event: NormalizedEvent
): boolean {
  if (event.source_kind !== "user") return false;

  if (family === "current_strategy" || family === "rejected_strategy") {
    return event.event_type === "user_confirmation" && event.trust_level === "high";
  }

  return (
    (event.event_type === "user_message" || event.event_type === "user_confirmation") &&
    (event.trust_level === "medium" || event.trust_level === "high")
  );
}

export function resolutionRuleSummary(rule: ResolutionRule): string {
  switch (rule.type) {
    case "issue_closed":
      return `issue_closed:${rule.issue_id}`;
    case "pr_merged":
      return `pr_merged:${rule.pr_id}`;
    case "branch_deleted":
      return `branch_deleted:${rule.branch}`;
    case "commit_contains":
      return `commit_contains:${rule.pattern}`;
    case "test_pass":
      return `test_pass:${rule.test_name}`;
  }
}
