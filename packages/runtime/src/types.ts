export type EventType =
  | "user_message"
  | "agent_message"
  | "file_edit"
  | "command_result"
  | "test_result"
  | "build_result"
  | "lint_result"
  | "benchmark_result"
  | "deploy_result"
  | "git_commit"
  | "git_revert"
  | "pr_opened"
  | "pr_merged"
  | "pr_closed"
  | "issue_link"
  | "issue_closed"
  | "issue_reopened"
  | "human_edit_after_agent"
  | "manual_override"
  | "session_start"
  | "session_end"
  | "user_confirmation";

export const STABLE_OUTCOME_TYPES = [
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
] as const;

export type OutcomeType = (typeof STABLE_OUTCOME_TYPES)[number];

export const POSITIVE_OUTCOME_TYPES = [
  "test_pass",
  "build_pass",
  "commit_kept",
  "issue_closed",
  "human_kept",
] as const satisfies readonly OutcomeType[];

export const NEGATIVE_OUTCOME_TYPES = [
  "test_fail",
  "build_fail",
  "commit_reverted",
  "issue_reopened",
  "human_corrected",
  "manual_override",
] as const satisfies readonly OutcomeType[];

export const SESSION_CHECKPOINT_STATUSES = ["active", "stale"] as const;
export type SessionCheckpointStatus = (typeof SESSION_CHECKPOINT_STATUSES)[number];

export const SESSION_CHECKPOINT_SOURCES = [
  "precompact",
  "session_end",
  "postcompact",
  "stop_failure",
] as const;
export type SessionCheckpointSource = (typeof SESSION_CHECKPOINT_SOURCES)[number];

export interface EventScope {
  repo?: string;
  branch?: string;
  cwd?: string;
  files?: string[];
}

export type EventSourceKind = "user" | "agent" | "system" | "operator" | "imported";
export type EventTrustLevel = "low" | "medium" | "high";
export type EventCapturePath =
  | "fixture.user_confirmation"
  | "fixture.user_message"
  | "claude_code.hook.user_confirmation"
  | "claude_code.hook.user_message"
  | "import.transcript"
  | "system.tool_observation"
  | "operator.manual";

export interface NormalizedEvent {
  id: string;
  ts: string;
  project_id: string;
  agent_id: string;
  agent_version: string;
  event_type: EventType;
  content: string;
  session_id?: string;
  workspace_id?: string;
  repo_id?: string;
  parent_event_id?: string;
  causation_id?: string;
  capture_path?: EventCapturePath;
  source_kind?: EventSourceKind;
  trust_level?: EventTrustLevel;
  scope?: EventScope;
  metadata?: Record<string, unknown>;
}

export type ClaimType = "fact" | "decision" | "thread";
export type ClaimCardinality = "singleton" | "set";
export type VerificationStatus =
  | "unverified"
  | "inferred"
  | "user_confirmed"
  | "system_verified"
  | "outcome_verified"
  | "disputed";
export type ClaimStatus = "active" | "stale" | "superseded" | "archived";
export type ThreadStatus = "open" | "resolved" | "blocked";

export interface ClaimScope {
  repo?: string;
  branch?: string;
  cwd_prefix?: string;
  files?: string[];
}

export interface ResolutionRuleIssueClosed {
  type: "issue_closed";
  issue_id: string;
}

export interface ResolutionRulePrMerged {
  type: "pr_merged";
  pr_id: string;
}

export interface ResolutionRuleBranchDeleted {
  type: "branch_deleted";
  branch: string;
}

export interface ResolutionRuleCommitContains {
  type: "commit_contains";
  pattern: string;
}

export interface ResolutionRuleTestPass {
  type: "test_pass";
  test_name: string;
}

export type ResolutionRule =
  | ResolutionRuleIssueClosed
  | ResolutionRulePrMerged
  | ResolutionRuleBranchDeleted
  | ResolutionRuleCommitContains
  | ResolutionRuleTestPass;

export interface Claim {
  id: string;
  created_at: string;
  project_id: string;
  type: ClaimType;
  assertion_kind:
    | "fact"
    | "hypothesis"
    | "instruction"
    | "preference"
    | "todo"
    | "outcome";
  canonical_key: string;
  cardinality: ClaimCardinality;
  content: string;
  source_event_ids: string[];
  confidence: number;
  importance: number;
  outcome_score: number;
  verification_status: VerificationStatus;
  verification_method?: string;
  status: ClaimStatus;
  pinned?: boolean;
  valid_from?: string;
  valid_to?: string;
  supersedes?: string[];
  last_verified_at?: string;
  last_activated_at?: string;
  scope?: ClaimScope;
  thread_status?: ThreadStatus;
  resolved_at?: string;
  resolution_rules?: ResolutionRule[];
}

export interface Outcome {
  id: string;
  ts: string;
  project_id: string;
  related_event_ids: string[];
  related_claim_ids?: string[];
  outcome_type: OutcomeType;
  strength: number;
  notes?: string;
}

export interface ClaimTransition {
  id: string;
  ts: string;
  project_id: string;
  claim_id: string;
  from_status?: ClaimStatus;
  to_status: ClaimStatus;
  reason: string;
  trigger_type: string;
  trigger_ref?: string;
  actor: string;
}

export type SuppressionReason =
  | "project_mismatch"
  | "scope_mismatch"
  | "verification_guard"
  | "superseded"
  | "archived"
  | "expired"
  | "low_rank"
  | "token_budget";

export interface ActivationLog {
  id: string;
  ts: string;
  project_id: string;
  claim_id: string;
  eligibility_result: "passed" | "filtered";
  suppression_reason?: SuppressionReason;
  rank_score?: number;
  packing_decision?: "included" | "dropped";
  activation_reasons?: string[];
}

export interface OutcomeSummary {
  positive_count: number;
  negative_count: number;
  outcome_types: OutcomeType[];
  last_outcome_at?: string;
}

export interface SessionCheckpoint {
  id: string;
  created_at: string;
  project_id: string;
  session_id: string;
  workspace_id?: string;
  branch?: string;
  repo_head?: string;
  status: SessionCheckpointStatus;
  source: SessionCheckpointSource;
  summary: string;
  current_goal?: string;
  next_action?: string;
  blocking_reason?: string;
  hot_claim_ids: string[];
  hot_files: string[];
  evidence_refs: string[];
  packet_hash: string;
  hot_file_digests?: Record<string, string>;
  stale_reason?: string;
}

export interface RecallCheckpoint {
  id: string;
  created_at: string;
  project_id: string;
  session_id: string;
  workspace_id?: string;
  branch?: string;
  repo_head?: string;
  status: SessionCheckpointStatus;
  source: SessionCheckpointSource;
  summary: string;
  current_goal?: string;
  next_action?: string;
  blocking_reason?: string;
  hot_claim_ids: string[];
  hot_files: string[];
  evidence_refs: string[];
  stale_reason?: string;
}

export interface RecallClaim extends Claim {
  recall_rank: number;
  activation_reasons: string[];
  evidence_refs: string[];
  outcome_summary?: OutcomeSummary;
}

export interface RecallPacket {
  project_id: string;
  generated_at: string;
  agent_id: string;
  brief: string;
  checkpoint?: RecallCheckpoint;
  active_claims: RecallClaim[];
  open_threads: RecallClaim[];
  recent_evidence_refs: string[];
  warnings?: string[];
}

export interface SessionBriefInput {
  project_id: string;
  session_id?: string;
  workspace_id?: string;
  agent_id: string;
  scope?: ClaimScope;
  debug?: boolean;
  cwd?: string;
}

export interface ProjectSnapshotInput {
  project_id: string;
  agent_id: string;
  scope?: ClaimScope;
  debug?: boolean;
  workspace_id?: string;
  cwd?: string;
}

export interface SearchClaimsInput {
  project_id: string;
  query: string;
  scope?: ClaimScope;
  debug?: boolean;
  limit?: number;
}

export interface RuntimeConfig {
  dataDir?: string;
  dbPath?: string;
  allowed_capture_paths?: EventCapturePath[];
}

export interface RuntimePaths {
  dataDir: string;
  dbPath: string;
}

export interface RuntimeStats {
  events: number;
  claims: number;
  outcomes: number;
  transitions: number;
  activationLogs: number;
  checkpoints: number;
  migrationsApplied: number;
}

export interface RuntimeAdminApi {
  insertClaimRecord(claim: Claim): void;
  insertOutcomeRecord(outcome: Outcome): void;
  insertSessionCheckpointRecord(checkpoint: SessionCheckpoint): void;
}

export interface VerifyClaimInput {
  claim_id: string;
  status: "system_verified" | "user_confirmed" | "disputed";
  method: string;
  ts?: string;
  actor?: string;
}

export interface MarkClaimStaleInput {
  claim_id: string;
  reason: string;
  ts?: string;
  actor?: string;
}

export interface OutcomeTimelineEntry {
  ts: string;
  event_type: string;
  description: string;
  score_before?: number;
  score_after?: number;
}

export interface ExplainClaimResult {
  claim: Claim;
  transitions: ClaimTransition[];
  activation_logs: ActivationLog[];
  related_outcomes: Outcome[];
  outcome_timeline: OutcomeTimelineEntry[];
}

export interface RecordSessionCheckpointInput {
  project_id: string;
  session_id: string;
  workspace_id?: string;
  agent_id: string;
  scope?: ClaimScope;
  cwd?: string;
  source: SessionCheckpointSource;
  summary_hint?: string;
  blocking_hint?: string;
}

export interface GetLatestCheckpointInput {
  project_id: string;
  workspace_id?: string;
  status?: SessionCheckpointStatus;
}

export interface VerifyCheckpointForSessionStartInput {
  project_id: string;
  workspace_id?: string;
  branch?: string;
  cwd?: string;
}

export interface VerifyCheckpointForSessionStartResult {
  checkpoint?: RecallCheckpoint;
  warnings: string[];
}
