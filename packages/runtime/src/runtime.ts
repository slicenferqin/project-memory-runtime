import { RuntimeStorage } from "./storage/sqlite.js";
import type {
  ActivationLog,
  Claim,
  ClaimScope,
  ClaimStatus,
  ClaimTransition,
  NormalizedEvent,
  Outcome,
  OutcomeType,
  ProjectSnapshotInput,
  RecallPacket,
  RuntimeConfig,
  RuntimePaths,
  RuntimeStats,
  SearchClaimsInput,
  SessionBriefInput,
} from "./types.js";
import { buildIngestionArtifacts } from "./ingestion/service.js";
import { buildRecallPacket } from "./recall/packet.js";

const POSITIVE_OUTCOMES = new Set<OutcomeType>([
  "test_pass",
  "build_pass",
  "commit_kept",
  "issue_closed",
  "human_kept",
]);

const NEGATIVE_OUTCOMES = new Set<OutcomeType>([
  "test_fail",
  "build_fail",
  "commit_reverted",
  "issue_reopened",
  "human_corrected",
  "manual_override",
]);

const STALE_TTL_DAYS: Record<Claim["type"], number> = {
  fact: 90,
  decision: 60,
  thread: 14,
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeScope(scope?: ClaimScope): ClaimScope | undefined {
  if (!scope) return undefined;

  const normalized: ClaimScope = {};
  if (scope.repo) normalized.repo = scope.repo;
  if (scope.branch) normalized.branch = scope.branch;
  if (scope.cwd_prefix) normalized.cwd_prefix = scope.cwd_prefix;
  if (scope.files?.length) normalized.files = [...scope.files].sort();

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function scopeSignature(scope?: ClaimScope): string {
  return JSON.stringify(normalizeScope(scope) ?? null);
}

function scorePositive(oldScore: number, strength: number): number {
  return clamp(oldScore + 0.1 * strength * (1 - oldScore), -1, 1);
}

function scoreNegative(oldScore: number, strength: number): number {
  return clamp(oldScore - 0.1 * strength * ((oldScore + 1) / 2), -1, 1);
}

function isPositiveOutcome(type: OutcomeType): boolean {
  return POSITIVE_OUTCOMES.has(type);
}

function isNegativeOutcome(type: OutcomeType): boolean {
  return NEGATIVE_OUTCOMES.has(type);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60 * 24);
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
  private initialized = false;

  constructor(config: RuntimeConfig = {}) {
    this.storage = new RuntimeStorage(config);
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

  recordEvent(event: NormalizedEvent): void {
    this.initialize();
    const inserted = this.storage.insertEventWithResult(event);
    if (!inserted) return;

    const artifacts = buildIngestionArtifacts(event);

    for (const claim of artifacts.claims) {
      const scopeJson = claim.scope ? JSON.stringify(claim.scope) : null;
      const existingClaims = this.storage.findActiveSingletonClaims(
        claim.project_id,
        claim.canonical_key,
        scopeJson
      );

      for (const existing of existingClaims) {
        if (existing.id === claim.id) continue;
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
      const inferredClaimIds = this.inferOutcomeClaimIds(event, outcome, artifacts.claims);
      if (inferredClaimIds.length > 0) {
        outcome.related_claim_ids = inferredClaimIds;
      } else {
        delete outcome.related_claim_ids;
      }
      this.applyOutcome(outcome);
    }
  }

  insertClaimRecord(claim: Claim): void {
    this.initialize();
    this.storage.insertClaim(claim);
  }

  insertOutcomeRecord(outcome: Outcome): void {
    this.initialize();
    this.applyOutcome(outcome);
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

  buildSessionBrief(input: SessionBriefInput): RecallPacket {
    this.initialize();
    const claims = this.storage.listClaims(input.project_id);
    return buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: input.agent_id,
        claims,
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
    return buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: input.agent_id,
        claims,
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
    const packet = buildRecallPacket(
      {
        projectId: input.project_id,
        agentId: "memory.search",
        claims,
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
}
