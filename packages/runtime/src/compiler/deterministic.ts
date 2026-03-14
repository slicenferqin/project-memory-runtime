import { createHash } from "node:crypto";
import type { Claim, ClaimScope, NormalizedEvent, Outcome, ResolutionRule } from "../types.js";
import { normalizeClaimScope } from "../scope.js";
import { familyHintAllowedForEvent } from "../validation.js";

interface MemoryHints {
  canonical_key_hint?: string;
  scope_hint?: ClaimScope;
  claim_type_hint?: Claim["type"];
  family_hint?: "current_strategy" | "blocker" | "rejected_strategy" | "open_question";
}

function hashId(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 24);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "unknown";
}

function normalizeScope(scope?: ClaimScope): ClaimScope | undefined {
  return normalizeClaimScope(scope);
}

function eventScopeToClaimScope(event: NormalizedEvent): ClaimScope | undefined {
  if (!event.scope) return undefined;
  return normalizeScope({
    repo: event.scope.repo,
    branch: event.scope.branch,
    cwd_prefix: event.scope.cwd,
    files: event.scope.files,
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asString).filter(Boolean) as string[];
  return items.length > 0 ? items : undefined;
}

function buildBaseClaim(
  event: NormalizedEvent,
  input: {
    type: Claim["type"];
    canonicalKey: string;
    content: string;
    assertionKind: Claim["assertion_kind"];
    verificationStatus?: Claim["verification_status"];
    verificationMethod?: string;
    scope?: ClaimScope;
    importance?: number;
    confidence?: number;
    threadStatus?: Claim["thread_status"];
    resolutionRules?: ResolutionRule[];
    status?: Claim["status"];
    resolvedAt?: string;
  }
): Claim {
  const scope = normalizeScope(input.scope);
  return {
    id: hashId(event.project_id, event.id, input.canonicalKey, JSON.stringify(scope ?? {})),
    created_at: event.ts,
    project_id: event.project_id,
    type: input.type,
    assertion_kind: input.assertionKind,
    canonical_key: input.canonicalKey,
    cardinality: "singleton",
    content: input.content,
    source_event_ids: [event.id],
    confidence: input.confidence ?? 0.8,
    importance: input.importance ?? 0.6,
    outcome_score: 0,
    verification_status: input.verificationStatus ?? "inferred",
    verification_method: input.verificationMethod,
    status: input.status ?? "active",
    scope,
    thread_status: input.threadStatus,
    resolved_at: input.resolvedAt,
    resolution_rules: input.resolutionRules,
  };
}

function extractPackageManager(event: NormalizedEvent): string | undefined {
  const metadataValue = asString(event.metadata?.package_manager);
  if (metadataValue) return metadataValue;

  const content = event.content.toLowerCase();
  if (/\bpnpm\b/.test(content)) return "pnpm";
  if (/\byarn\b/.test(content)) return "yarn";
  if (/\bbun\b/.test(content)) return "bun";
  if (/\bnpm\b/.test(content)) return "npm";
  return undefined;
}

function extractTestFramework(event: NormalizedEvent): string | undefined {
  const metadataValue = asString(event.metadata?.test_framework);
  if (metadataValue) return metadataValue;

  const content = event.content.toLowerCase();
  if (/\bvitest\b/.test(content)) return "vitest";
  if (/\bjest\b/.test(content)) return "jest";
  if (/\bpytest\b/.test(content)) return "pytest";
  if (/\bmocha\b/.test(content)) return "mocha";
  return undefined;
}

function extractBuildCommand(event: NormalizedEvent): string | undefined {
  const metadataValue = asString(event.metadata?.build_command);
  if (metadataValue) return metadataValue;

  const content = event.content;
  const match = content.match(/\b(?:pnpm|npm|yarn|bun)\s+build\b/);
  return match?.[0];
}

function extractDefaultBranch(event: NormalizedEvent): string | undefined {
  return asString(event.metadata?.default_branch);
}

function extractIssueId(event: NormalizedEvent): string | undefined {
  const explicit = asString(event.metadata?.issue_id);
  if (explicit) return explicit;

  const match = event.content.match(/#(\d+)/);
  return match?.[1];
}

function extractFailingTest(event: NormalizedEvent): string | undefined {
  if (event.event_type !== "test_result") return undefined;
  const exitCode = event.metadata?.exit_code;
  if (typeof exitCode === "number" && exitCode === 0) return undefined;
  const failingTest = asString(event.metadata?.failing_test);
  if (failingTest) return failingTest;
  return undefined;
}

function buildDecisionFromConfirmation(event: NormalizedEvent): Claim | null {
  if (event.event_type !== "user_confirmation") return null;

  const hints = (event.metadata?.memory_hints ?? {}) as MemoryHints;
  if (hints.family_hint) return null;
  const hintKey = asString(hints.canonical_key_hint);
  const content = asString(event.metadata?.decision_content) ?? event.content;
  const canonicalKey = hintKey ?? `decision.confirmed.${slugify(content)}`;

  return buildBaseClaim(event, {
    type: "decision",
    canonicalKey,
    content,
    assertionKind: "instruction",
    verificationStatus: "user_confirmed",
    verificationMethod: "user_confirmation",
    confidence: 0.95,
    importance: 0.8,
    scope: hints.scope_hint ?? eventScopeToClaimScope(event),
  });
}

function hintedFamilyCanonicalKey(
  family: NonNullable<MemoryHints["family_hint"]>,
  canonicalKeyHint: string | undefined,
  content: string
): string {
  const suffix = canonicalKeyHint ?? slugify(content);

  switch (family) {
    case "current_strategy":
      return `decision.current_strategy.${suffix}`;
    case "blocker":
      return `thread.blocker.${suffix}`;
    case "rejected_strategy":
      return `decision.rejected_strategy.${suffix}`;
    case "open_question":
      return `thread.open_question.${suffix}`;
  }
}

function buildHintedFamilyClaim(event: NormalizedEvent): Claim | null {
  const hints = (event.metadata?.memory_hints ?? {}) as MemoryHints;
  if (!hints.family_hint) return null;
  if (!familyHintAllowedForEvent(hints.family_hint, event)) return null;

  const content = asString(event.metadata?.claim_content) ?? event.content;
  const canonicalKey = hintedFamilyCanonicalKey(
    hints.family_hint,
    asString(hints.canonical_key_hint),
    content
  );
  const scope = hints.scope_hint ?? eventScopeToClaimScope(event);

  if (hints.family_hint === "current_strategy") {
    return buildBaseClaim(event, {
      type: "decision",
      canonicalKey,
      content,
      assertionKind: "instruction",
      verificationStatus: event.event_type === "user_confirmation" ? "user_confirmed" : "inferred",
      verificationMethod: event.event_type === "user_confirmation" ? "user_confirmation" : "memory_hint",
      confidence: event.event_type === "user_confirmation" ? 0.95 : 0.8,
      importance: 0.9,
      scope,
    });
  }

  if (hints.family_hint === "rejected_strategy") {
    return buildBaseClaim(event, {
      type: "decision",
      canonicalKey,
      content,
      assertionKind: "instruction",
      verificationStatus: event.event_type === "user_confirmation" ? "user_confirmed" : "inferred",
      verificationMethod: event.event_type === "user_confirmation" ? "user_confirmation" : "memory_hint",
      confidence: event.event_type === "user_confirmation" ? 0.9 : 0.75,
      importance: 0.88,
      scope,
    });
  }

  if (hints.family_hint === "blocker") {
    return buildBaseClaim(event, {
      type: "thread",
      canonicalKey,
      content,
      assertionKind: "todo",
      verificationStatus:
        event.event_type === "user_confirmation" ? "user_confirmed" : "unverified",
      verificationMethod: "memory_hint",
      confidence: 0.8,
      importance: 0.92,
      scope,
      threadStatus: "open",
      status: event.event_type === "user_confirmation" ? "active" : "stale",
    });
  }

  return buildBaseClaim(event, {
    type: "thread",
    canonicalKey,
    content,
    assertionKind: "todo",
    verificationStatus:
      event.event_type === "user_confirmation" ? "user_confirmed" : "unverified",
    verificationMethod: "memory_hint",
    confidence: 0.78,
    importance: 0.82,
    scope,
    threadStatus: "open",
    status: event.event_type === "user_confirmation" ? "active" : "stale",
  });
}

function buildNegativeMemoryDecision(event: NormalizedEvent): Claim | null {
  if (!["git_revert", "manual_override"].includes(event.event_type)) return null;

  const hints = (event.metadata?.memory_hints ?? {}) as MemoryHints;
  const overrideKey =
    asString(event.metadata?.overrides_canonical_key) ??
    asString(hints.canonical_key_hint);
  if (!overrideKey) return null;
  const canonicalKey = `decision.avoid.${overrideKey}`;

  const content =
    asString(event.metadata?.negative_memory_content) ??
    `Avoid repeating reverted or overridden approach: ${event.content}`;

  return buildBaseClaim(event, {
    type: "decision",
    canonicalKey,
    content,
    assertionKind: "instruction",
    verificationStatus: "outcome_verified",
    verificationMethod: "git_observation",
    confidence: 0.85,
    importance: 0.85,
    scope: hints.scope_hint ?? eventScopeToClaimScope(event),
  });
}

function buildIssueThread(event: NormalizedEvent, issueId: string): Claim {
  const scope = eventScopeToClaimScope(event);
  const resolved = event.event_type === "issue_closed";
  return buildBaseClaim(event, {
    type: "thread",
    canonicalKey: `thread.issue.${issueId}`,
    content: `Issue #${issueId} remains an active thread`,
    assertionKind: "todo",
    scope,
    importance: 0.8,
    confidence: 0.9,
    threadStatus: resolved ? "resolved" : "open",
    status: resolved ? "archived" : "active",
    resolvedAt: resolved ? event.ts : undefined,
    resolutionRules: [{ type: "issue_closed", issue_id: issueId }],
  });
}

function buildFailingTestThread(event: NormalizedEvent, failingTest: string): Claim {
  return buildBaseClaim(event, {
    type: "thread",
    canonicalKey: `thread.test.${slugify(failingTest)}`,
    content: `Failing test requires attention: ${failingTest}`,
    assertionKind: "todo",
    scope: eventScopeToClaimScope(event),
    importance: 0.85,
    confidence: 0.95,
    threadStatus: "open",
    resolutionRules: [{ type: "test_pass", test_name: failingTest } satisfies ResolutionRule],
  });
}

function buildHotfixThread(event: NormalizedEvent, branch: string): Claim {
  return buildBaseClaim(event, {
    type: "thread",
    canonicalKey: `thread.branch.${slugify(branch)}`,
    content: `Hotfix branch focus: ${branch}`,
    assertionKind: "todo",
    scope: normalizeScope({ branch }),
    importance: 0.75,
    confidence: 0.75,
    threadStatus: "open",
  });
}

function buildFactClaim(
  event: NormalizedEvent,
  canonicalKey: string,
  content: string,
  verificationStatus: Claim["verification_status"] = "system_verified",
  verificationMethod = "file_check"
): Claim {
  return buildBaseClaim(event, {
    type: "fact",
    canonicalKey,
    content,
    assertionKind: "fact",
    verificationStatus,
    verificationMethod,
    confidence: 0.9,
    importance: 0.7,
  });
}

function buildOutcome(event: NormalizedEvent, explicitType?: Outcome["outcome_type"]): Outcome | null {
  const explicitClaimIds = asStringArray(event.metadata?.related_claim_ids);

  const mapByEventType: Partial<Record<NormalizedEvent["event_type"], Outcome["outcome_type"]>> = {
    test_result:
      typeof event.metadata?.exit_code === "number" && event.metadata.exit_code === 0
        ? "test_pass"
        : "test_fail",
    build_result:
      typeof event.metadata?.exit_code === "number" && event.metadata.exit_code === 0
        ? "build_pass"
        : "build_fail",
    git_revert: "commit_reverted",
    issue_closed: "issue_closed",
    issue_reopened: "issue_reopened",
    human_edit_after_agent: "human_corrected",
    manual_override: "manual_override",
  };

  const outcomeType = explicitType ?? mapByEventType[event.event_type];
  if (!outcomeType) return null;

  return {
    id: hashId("outcome", event.id, outcomeType),
    ts: event.ts,
    project_id: event.project_id,
    related_event_ids: [event.id],
    related_claim_ids: explicitClaimIds,
    outcome_type: outcomeType,
    strength: typeof event.metadata?.strength === "number" ? event.metadata.strength : 1,
    notes: asString(event.metadata?.notes),
  };
}

export interface DeterministicExtractionResult {
  claims: Claim[];
  outcomes: Outcome[];
}

export function extractDeterministicArtifacts(
  event: NormalizedEvent
): DeterministicExtractionResult {
  const claims: Claim[] = [];
  const outcomes: Outcome[] = [];

  const packageManager = extractPackageManager(event);
  if (packageManager) {
    claims.push(
      buildFactClaim(event, "repo.package_manager", `Repo uses ${packageManager}`)
    );
  }

  const testFramework = extractTestFramework(event);
  if (testFramework) {
    claims.push(
      buildFactClaim(event, "repo.test_framework", `Repo uses ${testFramework}`)
    );
  }

  const buildCommand = extractBuildCommand(event);
  if (buildCommand) {
    claims.push(
      buildFactClaim(event, "repo.build_command", `Default build command: ${buildCommand}`)
    );
  }

  const defaultBranch = extractDefaultBranch(event);
  if (defaultBranch) {
    claims.push(
      buildFactClaim(event, "repo.default_branch", `Default branch is ${defaultBranch}`)
    );
  }

  const issueId = extractIssueId(event);
  if (issueId) {
    claims.push(buildIssueThread(event, issueId));
  }

  const failingTest = extractFailingTest(event);
  if (failingTest) {
    claims.push(buildFailingTestThread(event, failingTest));
  }

  const branch = event.scope?.branch;
  if (branch && /(hotfix|^fix\/|^bugfix\/)/i.test(branch)) {
    claims.push(buildHotfixThread(event, branch));
  }

  const decisionClaim = buildDecisionFromConfirmation(event);
  if (decisionClaim) claims.push(decisionClaim);

  const negativeDecision = buildNegativeMemoryDecision(event);
  if (negativeDecision) claims.push(negativeDecision);

  const hintedFamilyClaim = buildHintedFamilyClaim(event);
  if (hintedFamilyClaim) claims.push(hintedFamilyClaim);

  const outcome = buildOutcome(event);
  if (outcome) outcomes.push(outcome);

  return { claims, outcomes };
}
