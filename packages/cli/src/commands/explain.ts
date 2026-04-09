import process from "node:process";
import {
  createRuntime,
  isJson,
  runtimeDisabledMessage,
  truncate,
  type CliOptions,
} from "../shared.js";

export function runExplain(positional: string[], options: CliOptions): void {
  const disabledMessage = runtimeDisabledMessage(options);
  if (disabledMessage) {
    console.log(`Project Memory unavailable: ${disabledMessage}`);
    return;
  }

  const claimId = positional[0];
  if (!claimId) {
    console.error("Usage: pmr explain <claim-id>");
    process.exitCode = 1;
    return;
  }

  const runtime = createRuntime(options);
  try {
    const result = runtime.explainClaim(claimId);
    if (!result) {
      console.error(`Claim not found: ${claimId}`);
      process.exitCode = 1;
      return;
    }

    if (isJson(options)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const claim = result.claim;
    const conf = `${Math.round(claim.confidence * 100)}%`;
    const score = claim.outcome_score >= 0
      ? `+${claim.outcome_score.toFixed(2)}`
      : claim.outcome_score.toFixed(2);

    console.log(`Claim: ${claim.canonical_key} — "${truncate(claim.content, 80)}"`);
    console.log(`Status: ${claim.status} | Confidence: ${conf} | Score: ${score}`);
    console.log(`Type: ${claim.type} | Verification: ${claim.verification_status}`);
    if (claim.scope) {
      const scopeParts: string[] = [];
      if (claim.scope.repo) scopeParts.push(`repo:${claim.scope.repo}`);
      if (claim.scope.branch) scopeParts.push(`branch:${claim.scope.branch}`);
      if (claim.scope.cwd_prefix) scopeParts.push(`cwd:${claim.scope.cwd_prefix}`);
      if (scopeParts.length > 0) {
        console.log(`Scope: ${scopeParts.join(" | ")}`);
      }
    }

    // Evidence
    if (claim.source_event_ids.length > 0) {
      console.log(`\nEvidence (${claim.source_event_ids.length} source events):`);
      for (const eventId of claim.source_event_ids.slice(0, 5)) {
        console.log(`  ← ${eventId}`);
      }
      if (claim.source_event_ids.length > 5) {
        console.log(`  ... and ${claim.source_event_ids.length - 5} more`);
      }
    }

    // Transitions
    if (result.transitions.length > 0) {
      console.log(`\nTransitions (${result.transitions.length}):`);
      for (const t of result.transitions) {
        const from = t.from_status ?? "—";
        console.log(`  ${t.ts.slice(0, 10)}  ${from} → ${t.to_status}  (${t.reason})`);
      }
    }

    // Outcome Timeline (replaces raw outcomes for better UX)
    if (result.outcome_timeline.length > 0) {
      console.log(`\nTimeline:`);
      for (const entry of result.outcome_timeline) {
        const date = entry.ts.slice(0, 10);
        const scoreStr = entry.score_before !== undefined && entry.score_after !== undefined
          ? ` → score: ${entry.score_before >= 0 ? "+" : ""}${entry.score_before.toFixed(2)} → ${entry.score_after >= 0 ? "+" : ""}${entry.score_after.toFixed(2)}`
          : "";
        console.log(`  ${date}  ${entry.description}${scoreStr}`);
      }
    } else if (result.related_outcomes.length > 0) {
      // Fallback to raw outcomes if timeline is empty
      console.log(`\nOutcomes (${result.related_outcomes.length}):`);
      for (const o of result.related_outcomes) {
        const icon = ["test_pass", "build_pass", "commit_kept", "issue_closed", "human_kept"].includes(o.outcome_type) ? "✓" : "✗";
        console.log(`  ${o.ts.slice(0, 10)}  ${icon} ${o.outcome_type} (strength: ${o.strength})`);
      }
    }

    // Activation logs
    if (result.activation_logs.length > 0) {
      console.log(`\nActivation history: ${result.activation_logs.length} log(s)`);
    }
  } finally {
    runtime.close();
  }
}
