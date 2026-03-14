import { createHash } from "node:crypto";
import type {
  ActivationLog,
  Claim,
  ClaimScope,
  RecallClaim,
  SuppressionReason,
} from "../types.js";
import { normalizeClaimScope, scopeSignature, scopeSpecificity } from "../scope.js";

const DEFAULT_WEIGHTS = {
  relevance: 0.1,
  freshness: 0.1,
  confidence: 0.25,
  importance: 0.05,
  outcome: 0.15,
  scope: 0.3,
  pinBonus: 0.2,
} as const;

const FRESHNESS_LAMBDA: Record<Claim["type"], number> = {
  fact: 0.01,
  decision: 0.02,
  thread: 0.08,
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hashLogId(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 24);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24));
}

function claimAnchor(claim: Claim): string {
  return claim.last_verified_at ?? claim.created_at;
}

function freshness(claim: Claim, now: string): number {
  const lambda = FRESHNESS_LAMBDA[claim.type];
  return Math.exp(-lambda * daysBetween(claimAnchor(claim), now));
}

function fileScopeMatches(claimFiles: string[] | undefined, queryFiles: string[] | undefined): boolean {
  if (!claimFiles?.length) return true;
  if (!queryFiles?.length) return false;
  return claimFiles.every((claimFile) => queryFiles.includes(claimFile));
}

function cwdMatches(claimPrefix: string | undefined, queryPrefix: string | undefined): boolean {
  if (!claimPrefix) return true;
  if (!queryPrefix) return false;
  return queryPrefix === claimPrefix || queryPrefix.startsWith(`${claimPrefix}/`);
}

export function scopeCompatible(claimScope?: ClaimScope, requestedScope?: ClaimScope): boolean {
  const normalizedClaimScope = normalizeClaimScope(claimScope);
  const normalizedRequestedScope = normalizeClaimScope(requestedScope);

  if (!normalizedClaimScope) return true;
  if (!normalizedRequestedScope) return true;
  if (normalizedClaimScope.repo && normalizedClaimScope.repo !== normalizedRequestedScope.repo) {
    return false;
  }
  if (normalizedClaimScope.branch && normalizedClaimScope.branch !== normalizedRequestedScope.branch) {
    return false;
  }
  if (!cwdMatches(normalizedClaimScope.cwd_prefix, normalizedRequestedScope.cwd_prefix)) return false;
  if (!fileScopeMatches(normalizedClaimScope.files, normalizedRequestedScope.files)) return false;
  return true;
}

function computeScopeMatch(claimScope: ClaimScope | undefined, requestedScope: ClaimScope | undefined): number {
  const normalizedClaimScope = normalizeClaimScope(claimScope);
  const normalizedRequestedScope = normalizeClaimScope(requestedScope);

  if (!normalizedRequestedScope) return normalizedClaimScope ? 0.7 : 1.0;
  if (!normalizedClaimScope) return 0.6;
  if (!scopeCompatible(normalizedClaimScope, normalizedRequestedScope)) return 0;

  const requestedSpecificity = scopeSpecificity(normalizedRequestedScope);
  const claimSpecificity = scopeSpecificity(normalizedClaimScope);

  if (claimSpecificity >= requestedSpecificity) return 1.0;
  if (claimSpecificity === 0) return 0.6;
  return 0.8;
}

function computePinBonus(claim: Claim): number {
  let bonus = 0;
  if (claim.pinned) bonus += 1;
  if (claim.verification_status === "system_verified") bonus += 0.75;
  if (claim.verification_status === "user_confirmed") bonus += 1;
  if (claim.verification_status === "outcome_verified") bonus += 0.5;
  return bonus;
}

function computeBaseRelevance(
  claim: Claim,
  mode: ActivateClaimsOptions["mode"] = "search"
): number {
  if (mode === "session_brief") {
    if (claim.type === "thread") return claim.status === "stale" ? 0.72 : 0.9;
    if (claim.type === "decision") return 0.82;
    return claim.status === "stale" ? 0.45 : 0.62;
  }

  if (mode === "project_snapshot") {
    if (claim.type === "thread") return claim.status === "stale" ? 0.7 : 0.84;
    if (claim.type === "decision") return claim.status === "stale" ? 0.58 : 0.74;
    return claim.status === "stale" ? 0.52 : 0.66;
  }

  return 0.5;
}

function computeTextRelevance(
  claim: Claim,
  query: string | undefined,
  mode: ActivateClaimsOptions["mode"]
): number {
  if (!query) return computeBaseRelevance(claim, mode);
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return computeBaseRelevance(claim, mode);

  const haystack = tokenize(
    `${claim.canonical_key} ${claim.content} ${claim.type} ${claim.assertion_kind}`
  );
  if (haystack.length === 0) return 0;

  let matches = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) matches += 1;
  }

  return clamp(matches / queryTerms.length, 0, 1);
}

function isExpired(claim: Claim, now: string): boolean {
  return Boolean(claim.valid_to && new Date(claim.valid_to).getTime() < new Date(now).getTime());
}

function filterClaim(
  claim: Claim,
  input: {
    projectId: string;
    scope?: ClaimScope;
    includeResolvedThreads?: boolean;
    mode?: ActivateClaimsOptions["mode"];
  },
  now: string
): { eligible: true } | { eligible: false; reason: SuppressionReason } {
  if (claim.project_id !== input.projectId) return { eligible: false, reason: "project_mismatch" };
  if (claim.status === "superseded") return { eligible: false, reason: "superseded" };
  if (claim.status === "archived") return { eligible: false, reason: "archived" };
  if (isExpired(claim, now)) return { eligible: false, reason: "expired" };
  if (claim.verification_status === "disputed") return { eligible: false, reason: "verification_guard" };
  if (input.mode === "session_brief" && claim.verification_status === "unverified") {
    return { eligible: false, reason: "verification_guard" };
  }
  if (!scopeCompatible(claim.scope, input.scope)) return { eligible: false, reason: "scope_mismatch" };
  if (!input.includeResolvedThreads && claim.type === "thread" && claim.thread_status === "resolved") {
    return { eligible: false, reason: "archived" };
  }
  return { eligible: true };
}

function claimPriorityBucket(claim: Claim): number {
  if (claim.type === "decision" && claim.pinned) return 0;
  if (claim.type === "thread") return 1;
  if (claim.verification_status === "system_verified" || claim.verification_status === "user_confirmed") {
    return 2;
  }
  return 3;
}

export interface RankedClaim {
  claim: Claim;
  rankScore: number;
  activationReasons: string[];
}

export interface ActivationResult {
  selected: RecallClaim[];
  dropped: ActivationLog[];
  filtered: ActivationLog[];
}

export interface ActivateClaimsOptions {
  projectId: string;
  agentId: string;
  claims: Claim[];
  mode?: "session_brief" | "project_snapshot" | "search";
  scope?: ClaimScope;
  query?: string;
  debug?: boolean;
  now?: string;
  includeResolvedThreads?: boolean;
  maxItems: number;
  maxPerCanonicalKey?: number;
}

export function activateClaims(options: ActivateClaimsOptions): ActivationResult {
  const now = options.now ?? nowIso();
  const filtered: ActivationLog[] = [];
  const dropped: ActivationLog[] = [];
  const ranked: RankedClaim[] = [];

  for (const claim of options.claims) {
    const filter = filterClaim(
      claim,
      {
        projectId: options.projectId,
        scope: options.scope,
        includeResolvedThreads: options.includeResolvedThreads ?? false,
        mode: options.mode,
      },
      now
    );

    if (!filter.eligible) {
      filtered.push({
        id: hashLogId("flt", options.projectId, claim.id, filter.reason, now),
        ts: now,
        project_id: options.projectId,
        claim_id: claim.id,
        eligibility_result: "filtered",
        suppression_reason: filter.reason,
      });
      continue;
    }

    const relevance = computeTextRelevance(claim, options.query, options.mode);
    const fresh = freshness(claim, now);
    const confidence = claim.confidence;
    const importance = claim.importance;
    const outcome = clamp((claim.outcome_score + 1) / 2, 0, 1);
    const scopeMatch = computeScopeMatch(claim.scope, options.scope);
    const pinBonus = computePinBonus(claim);

    const score =
      DEFAULT_WEIGHTS.relevance * relevance +
      DEFAULT_WEIGHTS.freshness * fresh +
      DEFAULT_WEIGHTS.confidence * confidence +
      DEFAULT_WEIGHTS.importance * importance +
      DEFAULT_WEIGHTS.outcome * outcome +
      DEFAULT_WEIGHTS.scope * scopeMatch +
      DEFAULT_WEIGHTS.pinBonus * pinBonus;

    const reasons = [
      `relevance:${relevance.toFixed(2)}`,
      `freshness:${fresh.toFixed(2)}`,
      `scope:${scopeMatch.toFixed(2)}`,
      `verification:${claim.verification_status}`,
    ];
    if (claim.pinned) reasons.push("pinned");
    if (claim.type === "thread" && claim.thread_status) reasons.push(`thread:${claim.thread_status}`);

    ranked.push({
      claim,
      rankScore: score,
      activationReasons: reasons,
    });
  }

  ranked.sort((a, b) => {
    const bucketDelta = claimPriorityBucket(a.claim) - claimPriorityBucket(b.claim);
    if (bucketDelta !== 0) return bucketDelta;
    const specificityDelta =
      scopeSpecificity(normalizeClaimScope(b.claim.scope)) -
      scopeSpecificity(normalizeClaimScope(a.claim.scope));
    if (specificityDelta !== 0) return specificityDelta;
    return b.rankScore - a.rankScore;
  });

  const selected: RecallClaim[] = [];
  const seenSingletons = new Set<string>();
  const maxPerCanonicalKey = options.maxPerCanonicalKey ?? 1;
  const seenCounts = new Map<string, number>();

  for (const entry of ranked) {
    const singletonSlot = entry.claim.canonical_key;
    const countKey =
      entry.claim.cardinality === "singleton"
        ? singletonSlot
        : `${entry.claim.canonical_key}:${scopeSignature(entry.claim.scope)}`;
    const currentCount = seenCounts.get(countKey) ?? 0;

    if (entry.claim.cardinality === "singleton" && seenSingletons.has(singletonSlot)) {
      dropped.push({
        id: hashLogId("drp", options.projectId, entry.claim.id, "low_rank", now),
        ts: now,
        project_id: options.projectId,
        claim_id: entry.claim.id,
        eligibility_result: "passed",
        suppression_reason: "low_rank",
        rank_score: entry.rankScore,
        packing_decision: "dropped",
      });
      continue;
    }

    if (currentCount >= maxPerCanonicalKey) {
      dropped.push({
        id: hashLogId("drp", options.projectId, entry.claim.id, "low_rank", now),
        ts: now,
        project_id: options.projectId,
        claim_id: entry.claim.id,
        eligibility_result: "passed",
        suppression_reason: "low_rank",
        rank_score: entry.rankScore,
        packing_decision: "dropped",
      });
      continue;
    }

    if (selected.length >= options.maxItems) {
      dropped.push({
        id: hashLogId("drp", options.projectId, entry.claim.id, "token_budget", now),
        ts: now,
        project_id: options.projectId,
        claim_id: entry.claim.id,
        eligibility_result: "passed",
        suppression_reason: "token_budget",
        rank_score: entry.rankScore,
        packing_decision: "dropped",
      });
      continue;
    }

    selected.push({
      ...entry.claim,
      recall_rank: selected.length + 1,
      activation_reasons: entry.activationReasons,
      evidence_refs: [...entry.claim.source_event_ids],
    });
    seenCounts.set(countKey, currentCount + 1);
    if (entry.claim.cardinality === "singleton") seenSingletons.add(singletonSlot);
  }

  return { selected, dropped, filtered };
}
