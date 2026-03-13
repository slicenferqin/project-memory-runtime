import type { ActivationLog, Claim, ClaimScope, RecallPacket } from "../types.js";
import { activateClaims } from "../activation/engine.js";

function nowIso(): string {
  return new Date().toISOString();
}

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

export interface BuildRecallPacketInput {
  projectId: string;
  agentId: string;
  claims: Claim[];
  scope?: ClaimScope;
  debug?: boolean;
  query?: string;
  mode: "session_brief" | "project_snapshot" | "search";
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
      query: input.query,
      maxItems: input.mode === "project_snapshot" ? 8 : 4,
      includeResolvedThreads: false,
      maxPerCanonicalKey: 1,
      claims: input.claims.filter((claim) => claim.type === "thread"),
    }
  );

  const activeClaimsResult = activateClaims(
    {
      ...baseOptions,
      query: input.query,
      maxItems: input.mode === "project_snapshot" ? 12 : input.mode === "search" ? 10 : 8,
      includeResolvedThreads: false,
      maxPerCanonicalKey: 1,
      claims: input.claims.filter((claim) => claim.type !== "thread"),
    }
  );

  insertActivationLogs(openThreadsResult.filtered, writeActivationLog);
  insertActivationLogs(openThreadsResult.dropped, writeActivationLog);
  insertActivationLogs(activeClaimsResult.filtered, writeActivationLog);
  insertActivationLogs(activeClaimsResult.dropped, writeActivationLog);

  const recentEvidenceRefs = Array.from(
    new Set(
      [...openThreadsResult.selected, ...activeClaimsResult.selected]
        .flatMap((claim) => claim.evidence_refs)
        .slice(0, 10)
    )
  );

  return {
    project_id: input.projectId,
    generated_at: nowIso(),
    agent_id: input.agentId,
    brief: buildBrief(activeClaimsResult.selected, openThreadsResult.selected),
    active_claims: activeClaimsResult.selected,
    open_threads: openThreadsResult.selected,
    recent_evidence_refs: recentEvidenceRefs,
    warnings:
      input.mode === "search" && activeClaimsResult.selected.length === 0 && openThreadsResult.selected.length === 0
        ? ["No claims matched current search and scope."]
        : undefined,
  };
}
