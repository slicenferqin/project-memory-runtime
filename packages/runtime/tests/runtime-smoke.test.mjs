import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("runtime initializes sqlite schema and stores minimal records", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-runtime-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.initialize();

  runtime.recordEvent({
    id: "evt-1",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "session_start",
    content: "Session started",
  });

  runtime.insertClaimRecord({
    id: "clm-1",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "repo.package_manager",
    cardinality: "singleton",
    content: "Repo uses pnpm",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.7,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  runtime.insertOutcomeRecord({
    id: "out-1",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-1"],
    outcome_type: "test_pass",
    strength: 1,
  });

  const stats = runtime.getStats();
  assert.equal(stats.migrationsApplied, 1);
  assert.equal(stats.events, 1);
  assert.equal(stats.claims, 1);
  assert.equal(stats.outcomes, 1);
  assert.equal(stats.transitions, 0);
  assert.equal(stats.activationLogs, 0);

  runtime.close();
});

test("runtime records deterministic fact, thread, decision and outcome artifacts", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-ingest-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });

  runtime.recordEvent({
    id: "evt-pm",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "agent_message",
    content: "The repo uses pnpm and vitest. Run pnpm build.",
  });

  runtime.recordEvent({
    id: "evt-issue",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "issue_link",
    content: "Tracking issue #42",
    metadata: { issue_id: "42" },
  });

  runtime.recordEvent({
    id: "evt-test",
    ts: "2026-03-12T00:00:02.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "test_result",
    content: "Test run failed",
    scope: { branch: "fix/windows-install" },
    metadata: {
      exit_code: 1,
      failing_test: "Windows install path normalizer",
    },
  });

  runtime.recordEvent({
    id: "evt-decision",
    ts: "2026-03-12T00:00:03.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    content: "Use SQLite as the first persistence backend",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-override",
    ts: "2026-03-12T00:00:04.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "manual_override",
    content: "The previous JSON backend approach was reverted",
    metadata: {
      overrides_canonical_key: "decision.persistence.backend",
    },
  });

  const claims = runtime.listClaims("github.com/acme/demo");
  const outcomes = runtime.listOutcomes("github.com/acme/demo");

  assert.ok(claims.some((claim) => claim.canonical_key === "repo.package_manager"));
  assert.ok(claims.some((claim) => claim.canonical_key === "repo.test_framework"));
  assert.ok(claims.some((claim) => claim.canonical_key === "repo.build_command"));
  assert.ok(claims.some((claim) => claim.canonical_key === "thread.issue.42"));
  assert.ok(claims.some((claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer"));
  assert.ok(claims.some((claim) => claim.canonical_key === "thread.branch.fix.windows.install"));
  assert.ok(claims.some((claim) => claim.canonical_key === "decision.persistence.backend"));
  assert.ok(claims.some((claim) => claim.canonical_key === "decision.avoid.decision.persistence.backend"));
  assert.ok(outcomes.some((outcome) => outcome.outcome_type === "test_fail"));
  assert.ok(outcomes.some((outcome) => outcome.outcome_type === "manual_override"));

  runtime.close();
});

test("runtime applies positive and negative outcomes to claim lifecycle", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-lifecycle-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.initialize();

  runtime.insertClaimRecord({
    id: "clm-decision",
    created_at: "2026-03-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend",
    cardinality: "singleton",
    content: "Use SQLite as backend",
    source_event_ids: ["evt-seed"],
    confidence: 0.9,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
  });

  runtime.insertOutcomeRecord({
    id: "out-negative",
    ts: "2026-03-02T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-override"],
    related_claim_ids: ["clm-decision"],
    outcome_type: "manual_override",
    strength: 1,
  });

  let claim = runtime.listClaims("github.com/acme/demo").find((entry) => entry.id === "clm-decision");
  assert.ok(claim);
  assert.equal(claim.status, "stale");
  assert.ok(claim.outcome_score < 0);

  runtime.insertOutcomeRecord({
    id: "out-positive",
    ts: "2026-03-03T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-test-pass"],
    related_claim_ids: ["clm-decision"],
    outcome_type: "test_pass",
    strength: 1,
  });

  claim = runtime.listClaims("github.com/acme/demo").find((entry) => entry.id === "clm-decision");
  assert.ok(claim);
  assert.equal(claim.status, "active");
  assert.equal(claim.last_verified_at, "2026-03-03T00:00:00.000Z");

  const transitions = runtime.listClaimTransitions("github.com/acme/demo");
  assert.ok(transitions.some((entry) => entry.to_status === "stale"));
  assert.ok(transitions.some((entry) => entry.to_status === "active"));

  runtime.close();
});

test("runtime sweeps stale claims using last_verified_at or created_at", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-stale-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.initialize();

  runtime.insertClaimRecord({
    id: "clm-fact-old",
    created_at: "2025-01-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "repo.package_manager",
    cardinality: "singleton",
    content: "Repo uses pnpm",
    source_event_ids: ["evt-old"],
    confidence: 0.8,
    importance: 0.7,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  runtime.insertClaimRecord({
    id: "clm-decision-recent",
    created_at: "2025-01-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.runtime.mode",
    cardinality: "singleton",
    content: "Use runtime-first architecture",
    source_event_ids: ["evt-decision"],
    confidence: 0.9,
    importance: 0.9,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
    last_verified_at: "2026-03-10T00:00:00.000Z",
  });

  const changed = runtime.sweepStaleClaims("2026-03-13T00:00:00.000Z");
  assert.equal(changed, 1);

  const claims = runtime.listClaims("github.com/acme/demo");
  const oldFact = claims.find((entry) => entry.id === "clm-fact-old");
  const recentDecision = claims.find((entry) => entry.id === "clm-decision-recent");
  assert.ok(oldFact);
  assert.ok(recentDecision);
  assert.equal(oldFact.status, "stale");
  assert.equal(recentDecision.status, "active");

  runtime.close();
});

test("runtime builds session brief and search results with activation logs", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-recall-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.initialize();

  runtime.insertClaimRecord({
    id: "clm-fact",
    created_at: "2026-03-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "repo.package_manager",
    cardinality: "singleton",
    content: "Repo uses pnpm",
    source_event_ids: ["evt-fact"],
    confidence: 0.9,
    importance: 0.6,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  runtime.insertClaimRecord({
    id: "clm-thread-open",
    created_at: "2026-03-02T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.issue.42",
    cardinality: "singleton",
    content: "Issue #42 remains open",
    source_event_ids: ["evt-thread"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "inferred",
    status: "active",
    thread_status: "open",
    scope: {
      branch: "fix/windows-install",
    },
  });

  runtime.insertClaimRecord({
    id: "clm-thread-resolved",
    created_at: "2026-03-02T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.issue.43",
    cardinality: "singleton",
    content: "Issue #43 resolved",
    source_event_ids: ["evt-thread-2"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "inferred",
    status: "archived",
    thread_status: "resolved",
    resolved_at: "2026-03-03T00:00:00.000Z",
  });

  runtime.insertClaimRecord({
    id: "clm-stale",
    created_at: "2026-01-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "repo.default_branch",
    cardinality: "singleton",
    content: "Default branch is main",
    source_event_ids: ["evt-stale"],
    confidence: 0.5,
    importance: 0.5,
    outcome_score: 0,
    verification_status: "inferred",
    status: "stale",
  });

  const brief = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: { branch: "fix/windows-install" },
  });

  assert.equal(brief.project_id, "github.com/acme/demo");
  assert.ok(brief.brief.includes("Current"));
  assert.ok(brief.active_claims.some((claim) => claim.canonical_key === "repo.package_manager"));
  assert.ok(brief.open_threads.some((claim) => claim.canonical_key === "thread.issue.42"));
  assert.ok(!brief.open_threads.some((claim) => claim.canonical_key === "thread.issue.43"));

  const searchPacket = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "pnpm",
    scope: {},
    limit: 5,
  });

  assert.ok(searchPacket.active_claims.some((claim) => claim.canonical_key === "repo.package_manager"));

  const activationLogs = runtime.listActivationLogs("github.com/acme/demo");
  assert.ok(activationLogs.length > 0);
  assert.ok(
    activationLogs.some((log) => log.suppression_reason === "archived" || log.suppression_reason === "token_budget")
  );

  runtime.close();
});
