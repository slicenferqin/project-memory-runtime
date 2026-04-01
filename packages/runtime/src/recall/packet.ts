import type { ActivationLog, Claim, ClaimScope, Outcome, OutcomeSummary, RecallClaim, RecallPacket } from "../types.js";
import { activateClaims } from "../activation/engine.js";
import { nowIso, daysBetween, POSITIVE_OUTCOME_TYPES, NEGATIVE_OUTCOME_TYPES } from "../utils.js";

const STALE_WARNING_TTL_DAYS: Record<Claim["type"], number> = {
  fact: 90,
  decision: 60,
  thread: 14,
};

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function buildBrief(activeClaims: RecallPacket["active_claims"], openThreads: RecallPacket["open_threads"]): string {
  const lines: string[] = [];

  const topDecision = activeClaims.find((claim) => claim.type === "decision");
  const topFact = activeClaims.find((claim) => claim.type === "fact");

  if (topDecision) {
    lines.push(`Current decision: ${truncate(topDecision.content, 120)}`);
  } else if (topFact) {
    lines.push(`Current fact: ${truncate(topFact.content, 120)}`);
  } else {
    lines.push("Current project context is available in active claims.");
  }

  if (openThreads.length > 0) {
    const threadLine = openThreads
      .slice(0, 3)
      .map((thread) => truncate(thread.content, 80))
      .join(" | ");
    lines.push(`Open threads: ${threadLine}`);
  }

  return lines.join("\n");
}

function insertActivationLogs(logs: ActivationLog[], writer?: (log: ActivationLog) => void): void {
  if (!writer) return;
  for (const log of logs) writer(log);
}

function selectOpenThreadCandidates(claims: Claim[]): Claim[] {
  return claims.filter((claim) => claim.type === "thread");
}

function selectActiveClaimCandidates(
  claims: Claim[],
  mode: BuildRecallPacketInput["mode"]
): Claim[] {
  const nonThreadClaims = claims.filter((claim) => claim.type !== "thread");
  if (mode !== "session_brief") return nonThreadClaims;
  return nonThreadClaims.filter((claim) => claim.status === "active");
}

export interface BuildRecallPacketInput {
  projectId: string;
  agentId: string;
  claims: Claim[];
  outcomes?: Outcome[];
  scope?: ClaimScope;
  debug?: boolean;
  query?: string;
  mode: "session_brief" | "project_snapshot" | "search";
}

function buildOutcomeSummaryMap(outcomes: Outcome[]): Map<string, OutcomeSummary> {
  const map = new Map<string, OutcomeSummary>();

  for (const outcome of outcomes) {
    for (const claimId of outcome.related_claim_ids ?? []) {
      let summary = map.get(claimId);
      if (!summary) {
        summary = { positive_count: 0, negative_count: 0, outcome_types: [] };
        map.set(claimId, summary);
      }

      if (POSITIVE_OUTCOME_TYPES.has(outcome.outcome_type)) {
        summary.positive_count += 1;
      } else if (NEGATIVE_OUTCOME_TYPES.has(outcome.outcome_type)) {
        summary.negative_count += 1;
      }

      if (!summary.outcome_types.includes(outcome.outcome_type)) {
        summary.outcome_types.push(outcome.outcome_type);
      }

      if (!summary.last_outcome_at || outcome.ts > summary.last_outcome_at) {
        summary.last_outcome_at = outcome.ts;
      }
    }
  }

  return map;
}

function enrichClaimsWithOutcomeSummary(
  claims: RecallClaim[],
  summaryMap: Map<string, OutcomeSummary>
): RecallClaim[] {
  return claims.map((claim) => {
    const summary = summaryMap.get(claim.id);
    return summary ? { ...claim, outcome_summary: summary } : claim;
  });
}

function buildStaleWarnings(
  activeClaims: RecallClaim[],
  openThreads: RecallClaim[],
  now: string
): string[] {
  const warnings: string[] = [];
  const allClaims = [...activeClaims, ...openThreads];

  for (const claim of allClaims) {
    const ttlDays = STALE_WARNING_TTL_DAYS[claim.type];
    const anchor = claim.last_verified_at ?? claim.created_at;
    const daysSinceVerification = daysBetween(anchor, now);

    // Warn if approaching stale threshold (within 80% of TTL)
    if (claim.status === "active" && daysSinceVerification >= ttlDays * 0.8) {
      warnings.push(
        `${claim.canonical_key}: approaching stale (no verification in ${Math.round(daysSinceVerification)} days, threshold: ${ttlDays})`
      );
    }

    // Warn if claim was recently demoted by negative outcome
    if (claim.status === "stale" && claim.outcome_summary) {
      if (claim.outcome_summary.negative_count > 0) {
        warnings.push(
          `${claim.canonical_key}: demoted by failing ${claim.outcome_summary.outcome_types.filter((t) => NEGATIVE_OUTCOME_TYPES.has(t)).join("/")}`
        );
      }
    }
  }

  return warnings;
}

export function buildRecallPacket(
  input: BuildRecallPacketInput,
  writeActivationLog?: (log: ActivationLog) => void
): RecallPacket {
  const baseOptions = {
    projectId: input.projectId,
    agentId: input.agentId,
    claims: input.claims,
    scope: input.scope,
    debug: input.debug,
  };

  const openThreadsResult = activateClaims(
    {
      ...baseOptions,
      mode: input.mode,
      query: input.query,
      maxItems: input.mode === "project_snapshot" ? 8 : 4,
      includeResolvedThreads: false,
      maxPerCanonicalKey: 1,
      claims: selectOpenThreadCandidates(input.claims),
    }
  );

  const activeClaimsResult = activateClaims(
    {
      ...baseOptions,
      mode: input.mode,
      query: input.query,
      maxItems: input.mode === "project_snapshot" ? 12 : input.mode === "search" ? 10 : 8,
      includeResolvedThreads: false,
      maxPerCanonicalKey: 1,
      claims: selectActiveClaimCandidates(input.claims, input.mode),
    }
  );

  insertActivationLogs(openThreadsResult.filtered, writeActivationLog);
  insertActivationLogs(openThreadsResult.dropped, writeActivationLog);
  insertActivationLogs(activeClaimsResult.filtered, writeActivationLog);
  insertActivationLogs(activeClaimsResult.dropped, writeActivationLog);

  // Enrich claims with outcome summaries
  const outcomeSummaryMap = buildOutcomeSummaryMap(input.outcomes ?? []);
  const enrichedActiveClaims = enrichClaimsWithOutcomeSummary(activeClaimsResult.selected, outcomeSummaryMap);
  const enrichedOpenThreads = enrichClaimsWithOutcomeSummary(openThreadsResult.selected, outcomeSummaryMap);

  const recentEvidenceRefs = Array.from(
    new Set(
      [...enrichedActiveClaims, ...enrichedOpenThreads]
        .flatMap((claim) => claim.evidence_refs)
    )
  ).slice(0, 10);

  // Build warnings
  const now = nowIso();
  const staleWarnings = buildStaleWarnings(enrichedActiveClaims, enrichedOpenThreads, now);
  const searchWarning =
    input.mode === "search" && enrichedActiveClaims.length === 0 && enrichedOpenThreads.length === 0
      ? ["No claims matched current search and scope."]
      : [];
  const allWarnings = [...staleWarnings, ...searchWarning];

  return {
    project_id: input.projectId,
    generated_at: now,
    agent_id: input.agentId,
    brief: buildBrief(enrichedActiveClaims, enrichedOpenThreads),
    active_claims: enrichedActiveClaims,
    open_threads: enrichedOpenThreads,
    recent_evidence_refs: recentEvidenceRefs,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}
