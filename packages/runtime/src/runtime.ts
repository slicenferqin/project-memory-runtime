import { RuntimeStorage } from "./storage/sqlite.js";
import { nowIso, clamp, asString, daysBetween, hashId, POSITIVE_OUTCOME_TYPES, NEGATIVE_OUTCOME_TYPES } from "./utils.js";
import type {
  ActivationLog,
  Claim,
  ClaimStatus,
  ClaimTransition,
  EventCapturePath,
  ExplainClaimResult,
  MarkClaimStaleInput,
  NormalizedEvent,
  Outcome,
  OutcomeTimelineEntry,
  OutcomeType,
  ProjectSnapshotInput,
  RecallPacket,
  RuntimeConfig,
  RuntimeAdminApi,
  RuntimePaths,
  RuntimeStats,
  SearchClaimsInput,
  SessionBriefInput,
  VerifyClaimInput,
} from "./types.js";
import { buildRecallPacket } from "./recall/packet.js";
import { buildIngestionArtifacts } from "./ingestion/service.js";
import { scopeSignature } from "./scope.js";
import {
  DEFAULT_ALLOWED_CAPTURE_PATHS,
  RuntimeInvariantError,
  assertClaimTransitionAllowed,
  assertCapturePathAllowed,
  assertVerificationStatus,
  deriveEventProvenance,
  validateClaimRecord,
} from "./validation.js";

const STALE_TTL_DAYS: Record<Claim["type"], number> = {
  fact: 90,
  decision: 60,
  thread: 14,
};

function extractIssueId(event: NormalizedEvent): string | undefined {
  const explicit = asString(event.metadata?.issue_id);
  if (explicit) return explicit;
  const match = event.content.match(/#(\d+)/);
  return match?.[1];
}

function isSuccessfulTestResult(event: NormalizedEvent): boolean {
  return (
    event.event_type === "test_result" &&
    typeof event.metadata?.exit_code === "number" &&
    event.metadata.exit_code === 0
  );
}

function scorePositive(oldScore: number, strength: number): number {
  return clamp(oldScore + 0.1 * strength * (1 - oldScore), -1, 1);
}

function scoreNegative(oldScore: number, strength: number): number {
  return clamp(oldScore - 0.1 * strength * ((oldScore + 1) / 2), -1, 1);
}

function isPositiveOutcome(type: OutcomeType): boolean {
  return POSITIVE_OUTCOME_TYPES.has(type);
}

function isNegativeOutcome(type: OutcomeType): boolean {
  return NEGATIVE_OUTCOME_TYPES.has(type);
}

function buildTransition(
  claim: Claim,
  toStatus: ClaimStatus,
  reason: string,
  triggerType: string,
  triggerRef: string | undefined,
  actor: string
): ClaimTransition {
  return {
    id: `trn-${claim.id}-${toStatus}-${triggerRef ?? triggerType}`,
    ts: nowIso(),
    project_id: claim.project_id,
    claim_id: claim.id,
    from_status: claim.status,
    to_status: toStatus,
    reason,
    trigger_type: triggerType,
    trigger_ref: triggerRef,
    actor,
  };
}

export class ProjectMemoryRuntime {
  private readonly storage: RuntimeStorage;
  private readonly allowedCapturePaths: ReadonlySet<EventCapturePath>;
  private initialized = false;
  private readonly adminApi: RuntimeAdminApi;

  constructor(config: RuntimeConfig = {}) {
    this.storage = new RuntimeStorage(config);
    this.allowedCapturePaths = new Set(
      config.allowed_capture_paths ?? DEFAULT_ALLOWED_CAPTURE_PATHS
    );
    this.adminApi = {
      insertClaimRecord: (claim) => {
        this.initialize();
        this.storage.insertClaim(claim);
      },
      insertOutcomeRecord: (outcome) => {
        this.initialize();
        this.storage.transact(() => {
          this.applyOutcome(outcome);
        });
      },
    };
  }

  initialize(): void {
    if (this.initialized) return;
    this.storage.applyMigrations();
    this.initialized = true;
  }

  close(): void {
    this.storage.close();
    this.initialized = false;
  }

  getPaths(): RuntimePaths {
    return this.storage.paths;
  }

  getAdminApi(): RuntimeAdminApi {
    return this.adminApi;
  }

  recordEvent(event: NormalizedEvent): void {
    this.initialize();
    this.storage.transact(() => {
      const normalizedEvent = deriveEventProvenance(event);
      if (normalizedEvent.capture_path) {
        assertCapturePathAllowed(normalizedEvent.capture_path, this.allowedCapturePaths);
      }

      const inserted = this.storage.insertEventWithResult(normalizedEvent);
      if (!inserted) return;

      const artifacts = buildIngestionArtifacts(normalizedEvent);

      for (const claim of artifacts.claims) {
        const existingClaims = this.storage.findCompatibleActiveSingletonClaims(
          claim.project_id,
          claim.canonical_key,
          claim.scope,
          claim.id
        );

        for (const existing of existingClaims) {
          this.storage.supersedeClaim(
            existing.id,
            claim.id,
            "replaced by deterministic ingestion",
            "compiler",
            "system"
          );
        }

        this.storage.upsertClaim(claim);
      }

      for (const outcome of artifacts.outcomes) {
        const inferredClaimIds = this.inferOutcomeClaimIds(
          normalizedEvent,
          outcome,
          artifacts.claims
        );
        if (inferredClaimIds.length > 0) {
          outcome.related_claim_ids = inferredClaimIds;
        } else {
          delete outcome.related_claim_ids;
        }
        this.applyOutcome(outcome);
      }

      this.applyThreadResolutionSignals(normalizedEvent, artifacts.outcomes);
    });
  }

  getStats(): RuntimeStats {
    this.initialize();
    return this.storage.getStats();
  }

  listEvents(projectId?: string): NormalizedEvent[] {
    this.initialize();
    return this.storage.listEvents(projectId);
  }

  listClaims(projectId?: string): Claim[] {
    this.initialize();
    return this.storage.listClaims(projectId);
  }

  listOutcomes(projectId?: string): Outcome[] {
    this.initialize();
    return this.storage.listOutcomes(projectId);
  }

  listClaimTransitions(projectId?: string): ClaimTransition[] {
    this.initialize();
    return this.storage.listClaimTransitions(projectId);
  }

  listActivationLogs(projectId?: string): ActivationLog[] {
    this.initialize();
    return this.storage.listActivationLogs(projectId);
  }

  getClaim(claimId: string): Claim | undefined {
    this.initialize();
    return this.storage.getClaimById(claimId);
  }

  buildSessionBrief(input: SessionBriefInput): RecallPacket {
    this.initialize();
    const claims = this.storage.listClaims(input.project_id);
    const outcomes = this.storage.listOutcomes(input.project_id);
    return buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: input.agent_id,
        claims,
        outcomes,
        scope: input.scope,
        debug: input.debug,
        mode: "session_brief",
      },
      (log) => this.storage.insertActivationLog(log)
    );
  }

  buildProjectSnapshot(input: ProjectSnapshotInput): RecallPacket {
    this.initialize();
    const claims = this.storage.listClaims(input.project_id);
    const outcomes = this.storage.listOutcomes(input.project_id);
    return buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: input.agent_id,
        claims,
        outcomes,
        scope: input.scope,
        debug: input.debug,
        mode: "project_snapshot",
      },
      (log) => this.storage.insertActivationLog(log)
    );
  }

  searchClaims(input: SearchClaimsInput): RecallPacket {
    this.initialize();
    const claims = this.storage.listClaims(input.project_id);
    const outcomes = this.storage.listOutcomes(input.project_id);
    const packet = buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: "memory.search",
        claims,
        outcomes,
        scope: input.scope,
        debug: input.debug,
        query: input.query,
        mode: "search",
      },
      (log) => this.storage.insertActivationLog(log)
    );

    if (typeof input.limit === "number" && input.limit >= 0) {
      return {
        ...packet,
        active_claims: packet.active_claims.slice(0, input.limit),
        open_threads: packet.open_threads.slice(0, input.limit),
      };
    }

    return packet;
  }

  sweepStaleClaims(referenceTime: string = nowIso()): number {
    this.initialize();
    const claims = this.storage.listClaims();
    let changed = 0;

    for (const claim of claims) {
      if (claim.status !== "active") continue;
      if (claim.pinned) continue;

      const ttlDays = STALE_TTL_DAYS[claim.type];
      const anchor = claim.last_verified_at ?? claim.created_at;
      if (daysBetween(anchor, referenceTime) < ttlDays) continue;

      const updated: Claim = {
        ...claim,
        status: "stale",
      };
      assertClaimTransitionAllowed(claim.status, "stale", "stale_sweep");
      validateClaimRecord(updated);
      this.storage.upsertClaim(updated);
      this.storage.insertClaimTransition(
        buildTransition(
          claim,
          "stale",
          "stale TTL expired",
          "stale_sweep",
          undefined,
          "system"
        )
      );
      changed += 1;
    }

    return changed;
  }

  recordOutcome(input: {
    project_id: string;
    related_event_ids: string[];
    related_claim_ids?: string[];
    outcome_type: OutcomeType;
    strength: number;
    notes?: string;
  }): void {
    this.initialize();
    const outcome: Outcome = {
      id: hashId("out", input.project_id, nowIso(), input.outcome_type, ...input.related_event_ids),
      ts: nowIso(),
      project_id: input.project_id,
      related_event_ids: input.related_event_ids,
      related_claim_ids: input.related_claim_ids,
      outcome_type: input.outcome_type,
      strength: input.strength,
      notes: input.notes,
    };
    this.storage.transact(() => {
      this.applyOutcome(outcome);
    });
  }

  verifyClaim(input: VerifyClaimInput): Claim | undefined {
    this.initialize();
    assertVerificationStatus(input.status);
    const claim = this.storage.getClaimById(input.claim_id);
    if (!claim) return undefined;

    const ts = input.ts ?? nowIso();
    const updated: Claim = {
      ...claim,
      verification_status: input.status,
      verification_method: input.method,
      last_verified_at: input.status === "disputed" ? claim.last_verified_at : ts,
    };

    if (input.status === "disputed" && claim.status === "active") {
      assertClaimTransitionAllowed(claim.status, "stale", "verify_claim disputed");
      updated.status = "stale";
    } else if (
      input.status !== "disputed" &&
      (claim.status === "stale" || claim.status === "archived")
    ) {
      assertClaimTransitionAllowed(claim.status, "active", "verify_claim re-verified");
      updated.status = "active";
    }

    validateClaimRecord(updated);

    this.storage.transact(() => {
      this.storage.upsertClaim(updated);

      if (claim.status !== updated.status) {
        this.storage.insertClaimTransition(
          buildTransition(
            claim,
            updated.status,
            input.status === "disputed"
              ? `marked disputed by ${input.method}`
              : `re-verified by ${input.method}`,
            "verify_claim",
            claim.id,
            input.actor ?? "operator"
          )
        );
      }
    });

    return updated;
  }

  markClaimStale(input: MarkClaimStaleInput): Claim | undefined {
    this.initialize();
    const claim = this.storage.getClaimById(input.claim_id);
    if (!claim) return undefined;
    if (claim.status === "stale") return claim;
    if (claim.status === "archived" || claim.status === "superseded") {
      throw new RuntimeInvariantError(
        `cannot mark ${claim.status} claim stale: ${claim.id}`
      );
    }
    assertClaimTransitionAllowed(claim.status, "stale", "mark_claim_stale");

    const updated: Claim = {
      ...claim,
      status: "stale",
    };
    validateClaimRecord(updated);

    this.storage.transact(() => {
      this.storage.upsertClaim(updated);
      this.storage.insertClaimTransition(
        buildTransition(
          claim,
          "stale",
          input.reason,
          "mark_claim_stale",
          claim.id,
          input.actor ?? "operator"
        )
      );
    });

    return updated;
  }

  explainClaim(claimId: string): ExplainClaimResult | undefined {
    this.initialize();
    const claim = this.storage.getClaimById(claimId);
    if (!claim) return undefined;

    const sourceEventIds = new Set(claim.source_event_ids);
    const transitions = this.storage
      .listClaimTransitions(claim.project_id)
      .filter((entry) => entry.claim_id === claim.id);
    const activationLogs = this.storage
      .listActivationLogs(claim.project_id)
      .filter((entry) => entry.claim_id === claim.id);
    const relatedOutcomes = this.storage
      .listOutcomes(claim.project_id)
      .filter(
        (outcome) =>
          outcome.related_claim_ids?.includes(claim.id) ||
          outcome.related_event_ids.some((eventId) => sourceEventIds.has(eventId))
      );

    // Build outcome timeline
    const timeline: OutcomeTimelineEntry[] = [];

    // Add creation event
    timeline.push({
      ts: claim.created_at,
      event_type: "created",
      description: `Claim created (${claim.verification_status})`,
      score_before: undefined,
      score_after: 0,
    });

    // Add transitions
    for (const t of transitions) {
      timeline.push({
        ts: t.ts,
        event_type: `transition:${t.to_status}`,
        description: `${t.from_status ?? "—"} → ${t.to_status}: ${t.reason}`,
      });
    }

    // Add outcomes with score progression
    const sortedOutcomes = [...relatedOutcomes].sort((a, b) => a.ts.localeCompare(b.ts));
    let runningScore = 0;
    for (const outcome of sortedOutcomes) {
      const scoreBefore = runningScore;
      if (isPositiveOutcome(outcome.outcome_type)) {
        runningScore = scorePositive(runningScore, outcome.strength);
      } else if (isNegativeOutcome(outcome.outcome_type)) {
        runningScore = scoreNegative(runningScore, outcome.strength);
      }

      timeline.push({
        ts: outcome.ts,
        event_type: outcome.outcome_type,
        description: `${outcome.outcome_type}${outcome.notes ? `: ${outcome.notes}` : ""}`,
        score_before: scoreBefore,
        score_after: runningScore,
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => a.ts.localeCompare(b.ts));

    return {
      claim,
      transitions,
      activation_logs: activationLogs,
      related_outcomes: relatedOutcomes,
      outcome_timeline: timeline,
    };
  }

  private applyOutcome(outcome: Outcome): void {
    this.initialize();
    this.storage.upsertOutcome(outcome);

    const relatedClaims = this.resolveOutcomeClaims(outcome);
    for (const claim of relatedClaims) {
      const updated = { ...claim };
      if (isPositiveOutcome(outcome.outcome_type)) {
        updated.outcome_score = scorePositive(updated.outcome_score, outcome.strength);
        updated.last_verified_at = outcome.ts;

        if (updated.status === "stale") {
          assertClaimTransitionAllowed(claim.status, "active", "positive outcome");
          this.storage.insertClaimTransition(
            buildTransition(
              claim,
              "active",
              "reactivated by positive outcome",
              "outcome",
              outcome.id,
              "system"
            )
          );
          updated.status = "active";
        }
      } else if (isNegativeOutcome(outcome.outcome_type)) {
        updated.outcome_score = scoreNegative(updated.outcome_score, outcome.strength);

        if (updated.status === "active") {
          assertClaimTransitionAllowed(claim.status, "stale", "negative outcome");
          this.storage.insertClaimTransition(
            buildTransition(
              claim,
              "stale",
              "downgraded by negative outcome",
              "outcome",
              outcome.id,
              "system"
            )
          );
          updated.status = "stale";
        }
      }

      validateClaimRecord(updated);
      this.storage.upsertClaim(updated);
    }
  }

  private resolveOutcomeClaims(outcome: Outcome): Claim[] {
    const seen = new Set<string>();
    const claims: Claim[] = [];

    for (const claimId of outcome.related_claim_ids ?? []) {
      const claim = this.storage.getClaimById(claimId);
      if (!claim || seen.has(claim.id)) continue;
      seen.add(claim.id);
      claims.push(claim);
    }

    if (claims.length > 0) return claims;

    const allClaims = this.storage.listClaims(outcome.project_id);
    for (const claim of allClaims) {
      if (claim.source_event_ids.some((eventId) => outcome.related_event_ids.includes(eventId))) {
        if (this.shouldSkipFallbackOutcomeLink(claim, outcome)) continue;
        if (seen.has(claim.id)) continue;
        seen.add(claim.id);
        claims.push(claim);
      }
    }

    return claims;
  }

  private inferOutcomeClaimIds(event: NormalizedEvent, outcome: Outcome, newClaims: Claim[]): string[] {
    if (outcome.related_claim_ids?.length) {
      return Array.from(new Set(outcome.related_claim_ids));
    }

    if (!["manual_override", "commit_reverted"].includes(outcome.outcome_type)) {
      return [];
    }

    const targetCanonicalKey = asString(event.metadata?.overrides_canonical_key);
    if (!targetCanonicalKey) return [];

    const avoidanceClaim = newClaims.find(
      (claim) => claim.canonical_key === `decision.avoid.${targetCanonicalKey}`
    );
    const targetScopeSignature = scopeSignature(avoidanceClaim?.scope);

    const relatedClaims = this.storage
      .listClaims(event.project_id)
      .filter(
        (claim) =>
          claim.status === "active" &&
          claim.canonical_key === targetCanonicalKey &&
          (!avoidanceClaim || scopeSignature(claim.scope) === targetScopeSignature) &&
          !claim.source_event_ids.includes(event.id)
      )
      .map((claim) => claim.id);

    return Array.from(new Set(relatedClaims));
  }

  private shouldSkipFallbackOutcomeLink(claim: Claim, outcome: Outcome): boolean {
    if (!isNegativeOutcome(outcome.outcome_type)) return false;
    if (claim.canonical_key.startsWith("decision.avoid.")) return true;
    if (claim.type === "thread" && claim.thread_status === "open") return true;
    return false;
  }

  private applyThreadResolutionSignals(event: NormalizedEvent, outcomes: Outcome[]): void {
    const claims = this.storage.listClaims(event.project_id).filter(
      (claim) =>
        claim.type === "thread" &&
        claim.thread_status !== "resolved" &&
        claim.status !== "archived" &&
        claim.status !== "superseded"
    );

    for (const claim of claims) {
      if (!this.threadShouldResolve(claim, event, outcomes)) continue;
      this.resolveThreadClaim(claim, event.ts, outcomes[0]?.id);
    }
  }

  private threadShouldResolve(claim: Claim, event: NormalizedEvent, outcomes: Outcome[]): boolean {
    const matchedOutcomeTypes = new Set(outcomes.map((outcome) => outcome.outcome_type));
    const explicitlyRelated = outcomes.some((outcome) =>
      outcome.related_claim_ids?.includes(claim.id)
    );
    const issueId = extractIssueId(event);
    const failingTest = asString(event.metadata?.failing_test);

    for (const rule of claim.resolution_rules ?? []) {
      if (rule.type === "issue_closed") {
        if (issueId === rule.issue_id && (event.event_type === "issue_closed" || matchedOutcomeTypes.has("issue_closed"))) {
          return true;
        }
      }

      if (rule.type === "pr_merged") {
        const prId = asString(event.metadata?.pr_id);
        if (prId === rule.pr_id && event.event_type === "pr_merged") return true;
      }

      if (rule.type === "branch_deleted") {
        const branch = event.scope?.branch ?? asString(event.metadata?.branch);
        if (branch === rule.branch && asString(event.metadata?.branch_deleted) === "true") return true;
      }

      if (rule.type === "commit_contains") {
        if (event.event_type === "git_commit" && event.content.includes(rule.pattern)) return true;
      }

      if (rule.type === "test_pass") {
        if (matchedOutcomeTypes.has("test_pass") && explicitlyRelated) return true;
        if (isSuccessfulTestResult(event) && failingTest === rule.test_name) return true;
      }
    }

    return false;
  }

  private resolveThreadClaim(claim: Claim, resolvedAt: string, outcomeId?: string): void {
    const updated: Claim = {
      ...claim,
      thread_status: "resolved",
      resolved_at: resolvedAt,
      status: "archived",
      last_verified_at: resolvedAt,
    };
    assertClaimTransitionAllowed(claim.status, "archived", "resolution_rule");
    validateClaimRecord(updated);

    if (claim.status !== "archived") {
      this.storage.insertClaimTransition(
        buildTransition(
          claim,
          "archived",
          "resolved by lifecycle signal",
          "resolution_rule",
          outcomeId,
          "system"
        )
      );
    }

    this.storage.upsertClaim(updated);
  }
}
