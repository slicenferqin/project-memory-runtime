import type {
  Claim,
  EventCapturePath,
  ClaimStatus,
  EventType,
  EventSourceKind,
  EventTrustLevel,
  NormalizedEvent,
  Outcome,
  OutcomeType,
  ResolutionRule,
  SessionCheckpoint,
  SessionCheckpointStatus,
  VerificationStatus,
} from "./types.js";
import {
  SESSION_CHECKPOINT_STATUSES,
  SESSION_CHECKPOINT_SOURCES,
  STABLE_OUTCOME_TYPES,
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
const OUTCOME_TYPES = new Set(STABLE_OUTCOME_TYPES);
const SESSION_CHECKPOINT_STATUS_VALUES = new Set(SESSION_CHECKPOINT_STATUSES);
const SESSION_CHECKPOINT_SOURCE_VALUES = new Set(SESSION_CHECKPOINT_SOURCES);
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
const EVENT_CAPTURE_PATHS = new Set([
  "fixture.user_confirmation",
  "fixture.user_message",
  "claude_code.hook.user_confirmation",
  "claude_code.hook.user_message",
  "import.transcript",
  "system.tool_observation",
  "operator.manual",
]);
const ALLOWED_STATUS_TRANSITIONS: Record<ClaimStatus, Set<ClaimStatus>> = {
  active: new Set(["stale", "superseded", "archived"]),
  stale: new Set(["active", "superseded", "archived"]),
  superseded: new Set(["archived"]),
  archived: new Set(["active"]),
};
type CapturePathRule = {
  sourceKind: EventSourceKind;
  trustLevel: EventTrustLevel;
  eventTypes: readonly EventType[];
};

const CAPTURE_PATH_RULES: Record<EventCapturePath, CapturePathRule> = {
  "fixture.user_confirmation": {
    sourceKind: "user",
    trustLevel: "high",
    eventTypes: ["user_confirmation"],
  },
  "fixture.user_message": {
    sourceKind: "user",
    trustLevel: "medium",
    eventTypes: ["user_message"],
  },
  "claude_code.hook.user_confirmation": {
    sourceKind: "user",
    trustLevel: "high",
    eventTypes: ["user_confirmation"],
  },
  "claude_code.hook.user_message": {
    sourceKind: "user",
    trustLevel: "medium",
    eventTypes: ["user_message"],
  },
  "import.transcript": {
    sourceKind: "imported",
    trustLevel: "low",
    eventTypes: ["user_message", "agent_message", "user_confirmation", "session_start", "session_end"],
  },
  "system.tool_observation": {
    sourceKind: "system",
    trustLevel: "high",
    eventTypes: [
      "file_edit",
      "command_result",
      "test_result",
      "build_result",
      "lint_result",
      "benchmark_result",
      "deploy_result",
      "git_commit",
      "git_revert",
      "issue_link",
      "issue_closed",
      "issue_reopened",
    ],
  },
  "operator.manual": {
    sourceKind: "operator",
    trustLevel: "high",
    eventTypes: ["user_confirmation", "manual_override", "human_edit_after_agent"],
  },
};

const TRUSTED_USER_CONFIRMATION_CAPTURE_PATHS = new Set<EventCapturePath>([
  "fixture.user_confirmation",
  "claude_code.hook.user_confirmation",
  "operator.manual",
]);

const TRUSTED_USER_MESSAGE_CAPTURE_PATHS = new Set<EventCapturePath>([
  "fixture.user_message",
  "claude_code.hook.user_message",
]);

const TRUSTED_NEGATIVE_LIFECYCLE_CAPTURE_PATHS = new Set<EventCapturePath>([
  "operator.manual",
]);

export const DEFAULT_ALLOWED_CAPTURE_PATHS: EventCapturePath[] = [
  "fixture.user_confirmation",
  "fixture.user_message",
  "import.transcript",
  "system.tool_observation",
  "operator.manual",
];

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

function eventMemoryHints(
  event: NormalizedEvent
): { family_hint?: string; canonical_key_hint?: string } | undefined {
  const hints = event.metadata?.memory_hints;
  return hints && typeof hints === "object" ? (hints as { family_hint?: string; canonical_key_hint?: string }) : undefined;
}

export function assertEventType(eventType: string): asserts eventType is EventType {
  assertEnumValue<EventType>(eventType, EVENT_TYPES, "event_type");
}

export function assertCapturePath(
  capturePath: string
): asserts capturePath is EventCapturePath {
  assertEnumValue<EventCapturePath>(capturePath, EVENT_CAPTURE_PATHS, "capture_path");
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

export function assertSessionCheckpointStatus(
  status: string
): asserts status is SessionCheckpointStatus {
  assertEnumValue<SessionCheckpointStatus>(
    status,
    SESSION_CHECKPOINT_STATUS_VALUES,
    "session_checkpoint.status"
  );
}

export function validateSessionCheckpointRecord(checkpoint: SessionCheckpoint): void {
  assertSessionCheckpointStatus(checkpoint.status);
  assertEnumValue(
    checkpoint.source,
    SESSION_CHECKPOINT_SOURCE_VALUES,
    "session_checkpoint.source"
  );
  if (!checkpoint.project_id) {
    throw new RuntimeInvariantError("session_checkpoint.project_id is required");
  }
  if (!checkpoint.session_id) {
    throw new RuntimeInvariantError("session_checkpoint.session_id is required");
  }
  if (!checkpoint.summary) {
    throw new RuntimeInvariantError("session_checkpoint.summary is required");
  }
  if (!checkpoint.packet_hash) {
    throw new RuntimeInvariantError("session_checkpoint.packet_hash is required");
  }
  if (!Array.isArray(checkpoint.hot_claim_ids)) {
    throw new RuntimeInvariantError("session_checkpoint.hot_claim_ids must be an array");
  }
  if (!Array.isArray(checkpoint.hot_files)) {
    throw new RuntimeInvariantError("session_checkpoint.hot_files must be an array");
  }
  if (!Array.isArray(checkpoint.evidence_refs)) {
    throw new RuntimeInvariantError("session_checkpoint.evidence_refs must be an array");
  }
  if (
    checkpoint.hot_file_digests &&
    typeof checkpoint.hot_file_digests !== "object"
  ) {
    throw new RuntimeInvariantError("session_checkpoint.hot_file_digests must be an object");
  }
}

export function validateEventRecord(event: NormalizedEvent): void {
  assertEventType(event.event_type);
  if (event.capture_path) {
    assertCapturePath(event.capture_path);
    const rule = CAPTURE_PATH_RULES[event.capture_path];
    if (!rule.eventTypes.includes(event.event_type)) {
      throw new RuntimeInvariantError(
        `capture_path ${event.capture_path} does not allow event_type ${event.event_type}`
      );
    }
    if (event.source_kind && event.source_kind !== rule.sourceKind) {
      throw new RuntimeInvariantError(
        `capture_path ${event.capture_path} requires source_kind=${rule.sourceKind}`
      );
    }
    if (event.trust_level && event.trust_level !== rule.trustLevel) {
      throw new RuntimeInvariantError(
        `capture_path ${event.capture_path} requires trust_level=${rule.trustLevel}`
      );
    }
  }
  if (event.source_kind) {
    assertEnumValue<EventSourceKind>(event.source_kind, EVENT_SOURCE_KINDS, "source_kind");
  }
  if (event.trust_level) {
    assertEnumValue<EventTrustLevel>(event.trust_level, EVENT_TRUST_LEVELS, "trust_level");
  }
  if (eventMemoryHints(event)?.family_hint && !event.capture_path) {
    throw new RuntimeInvariantError("family_hint requires capture_path");
  }
}

export function assertCapturePathAllowed(
  capturePath: EventCapturePath,
  allowedCapturePaths: ReadonlySet<EventCapturePath>
): void {
  if (!allowedCapturePaths.has(capturePath)) {
    throw new RuntimeInvariantError(
      `capture_path ${capturePath} is not allowed by this runtime instance`
    );
  }
}

export function deriveEventProvenance(event: NormalizedEvent): NormalizedEvent {
  if (!event.capture_path) return event;

  const rule = CAPTURE_PATH_RULES[event.capture_path];
  return {
    ...event,
    source_kind: rule.sourceKind,
    trust_level: rule.trustLevel,
  };
}

export function hasTrustedUserConfirmationCapturePath(event: NormalizedEvent): boolean {
  const capturePath = event.capture_path;
  return (
    event.event_type === "user_confirmation" &&
    capturePath !== undefined &&
    TRUSTED_USER_CONFIRMATION_CAPTURE_PATHS.has(capturePath)
  );
}

export function hasTrustedUserMessageCapturePath(event: NormalizedEvent): boolean {
  const capturePath = event.capture_path;
  return (
    event.event_type === "user_message" &&
    capturePath !== undefined &&
    TRUSTED_USER_MESSAGE_CAPTURE_PATHS.has(capturePath)
  );
}

export function hasTrustedNegativeLifecycleCapturePath(event: NormalizedEvent): boolean {
  const capturePath = event.capture_path;
  return (
    (event.event_type === "manual_override" ||
      event.event_type === "human_edit_after_agent") &&
    capturePath !== undefined &&
    TRUSTED_NEGATIVE_LIFECYCLE_CAPTURE_PATHS.has(capturePath)
  );
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
  if (family === "current_strategy" || family === "rejected_strategy") {
    return hasTrustedUserConfirmationCapturePath(event);
  }

  return hasTrustedUserConfirmationCapturePath(event) || hasTrustedUserMessageCapturePath(event);
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
