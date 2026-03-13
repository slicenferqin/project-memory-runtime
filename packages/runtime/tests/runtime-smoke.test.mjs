import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("runtime initializes sqlite schema and stores minimal records", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-runtime-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
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

  admin.insertClaimRecord({
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

  admin.insertOutcomeRecord({
    id: "out-1",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-1"],
    outcome_type: "test_pass",
    strength: 1,
  });

  const stats = runtime.getStats();
  assert.equal(stats.migrationsApplied, 2);
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
  const originalDecision = claims.find((claim) => claim.canonical_key === "decision.persistence.backend");
  const avoidDecision = claims.find(
    (claim) => claim.canonical_key === "decision.avoid.decision.persistence.backend"
  );
  const failingThread = claims.find(
    (claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer"
  );
  const hotfixThread = claims.find((claim) => claim.canonical_key === "thread.branch.fix.windows.install");

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
  assert.equal(originalDecision?.status, "stale");
  assert.equal(avoidDecision?.status, "active");
  assert.equal(failingThread?.status, "active");
  assert.equal(hotfixThread?.status, "active");

  runtime.close();
});

test("runtime applies positive and negative outcomes to claim lifecycle", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-lifecycle-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
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

  admin.insertOutcomeRecord({
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

  admin.insertOutcomeRecord({
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

  const disputed = runtime.verifyClaim({
    claim_id: "clm-decision",
    status: "disputed",
    method: "review_dispute",
  });
  assert.ok(disputed);
  assert.equal(disputed.status, "stale");
  assert.equal(disputed.verification_status, "disputed");

  runtime.close();
});

test("runtime sweeps stale claims using last_verified_at or created_at", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-stale-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
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

  admin.insertClaimRecord({
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
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
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

  admin.insertClaimRecord({
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

  admin.insertClaimRecord({
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

  admin.insertClaimRecord({
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
  assert.ok(!brief.active_claims.some((claim) => claim.canonical_key === "repo.default_branch"));
  assert.ok(brief.open_threads.some((claim) => claim.canonical_key === "thread.issue.42"));
  assert.ok(!brief.open_threads.some((claim) => claim.canonical_key === "thread.issue.43"));

  const searchPacket = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "pnpm",
    scope: {},
    limit: 5,
  });

  assert.ok(searchPacket.active_claims.some((claim) => claim.canonical_key === "repo.package_manager"));

  const projectWideIssueSearch = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "issue",
    scope: {},
    limit: 5,
  });

  assert.ok(projectWideIssueSearch.open_threads.some((claim) => claim.canonical_key === "thread.issue.42"));

  const mismatchedScopeSearch = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "issue",
    scope: { branch: "other" },
    limit: 5,
  });

  assert.ok(!mismatchedScopeSearch.open_threads.some((claim) => claim.canonical_key === "thread.issue.42"));

  const activationLogs = runtime.listActivationLogs("github.com/acme/demo");
  assert.ok(activationLogs.length > 0);
  assert.ok(
    activationLogs.some((log) => log.suppression_reason === "archived" || log.suppression_reason === "token_budget")
  );

  runtime.close();
});

test("runtime resolves failing test thread when matching test passes", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-thread-resolution-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });

  runtime.recordEvent({
    id: "evt-test-fail",
    ts: "2026-03-12T00:00:00.000Z",
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

  let thread = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer");
  assert.equal(thread?.status, "active");
  assert.equal(thread?.thread_status, "open");

  runtime.recordEvent({
    id: "evt-test-pass",
    ts: "2026-03-12T00:00:10.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "test_result",
    content: "Test run passed",
    scope: { branch: "fix/windows-install" },
    metadata: {
      exit_code: 0,
      failing_test: "Windows install path normalizer",
    },
  });

  thread = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer");
  assert.equal(thread?.status, "archived");
  assert.equal(thread?.thread_status, "resolved");
  assert.equal(thread?.resolved_at, "2026-03-12T00:00:10.000Z");

  const transitions = runtime.listClaimTransitions("github.com/acme/demo");
  assert.ok(transitions.some((entry) => entry.to_status === "archived"));

  runtime.close();
});

test("runtime enforces active singleton invariant only within the same scope signature", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-scope-invariant-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
    id: "clm-branch-main",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend",
    cardinality: "singleton",
    content: "Use SQLite backend on main",
    source_event_ids: ["evt-branch-main"],
    confidence: 0.9,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
    scope: { branch: "main" },
  });

  admin.insertClaimRecord({
    id: "clm-repo-origin",
    created_at: "2026-03-12T00:01:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend",
    cardinality: "singleton",
    content: "Use repo-specific backend on origin",
    source_event_ids: ["evt-repo-origin"],
    confidence: 0.9,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
    scope: { repo: "origin" },
  });

  assert.throws(() =>
    admin.insertClaimRecord({
      id: "clm-branch-main-duplicate",
      created_at: "2026-03-12T00:01:00.000Z",
      project_id: "github.com/acme/demo",
      type: "decision",
      assertion_kind: "instruction",
      canonical_key: "decision.persistence.backend",
      cardinality: "singleton",
      content: "Use Postgres backend on main",
      source_event_ids: ["evt-branch-main-duplicate"],
      confidence: 0.9,
      importance: 0.8,
      outcome_score: 0,
      verification_status: "user_confirmed",
      status: "active",
      scope: { branch: "main" },
    })
  );

  const activeClaims = runtime
    .listClaims("github.com/acme/demo")
    .filter(
      (claim) =>
        claim.canonical_key === "decision.persistence.backend" && claim.status === "active"
    );
  assert.equal(activeClaims.length, 2);

  const repoScopedSnapshot = runtime.buildProjectSnapshot({
    project_id: "github.com/acme/demo",
    agent_id: "memoryctl",
    scope: { repo: "origin" },
  });
  assert.equal(
    repoScopedSnapshot.active_claims[0]?.canonical_key,
    "decision.persistence.backend"
  );
  assert.equal(repoScopedSnapshot.active_claims[0]?.scope?.repo, "origin");

  runtime.close();
});

test("runtime rejects illegal claim states and invalid verification values", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-invalid-claims-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  assert.throws(() =>
    admin.insertClaimRecord({
      id: "clm-invalid-verify",
      created_at: "2026-03-12T00:00:00.000Z",
      project_id: "github.com/acme/demo",
      type: "decision",
      assertion_kind: "instruction",
      canonical_key: "decision.invalid.verify",
      cardinality: "singleton",
      content: "Invalid verification status",
      source_event_ids: ["evt-invalid"],
      confidence: 0.8,
      importance: 0.8,
      outcome_score: 0,
      verification_status: "banana",
      status: "active",
    })
  );

  admin.insertClaimRecord({
    id: "clm-archived",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.issue.404",
    cardinality: "singleton",
    content: "Issue #404 resolved",
    source_event_ids: ["evt-archived"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "archived",
    thread_status: "resolved",
    resolved_at: "2026-03-12T00:00:01.000Z",
  });

  assert.throws(() =>
    runtime.markClaimStale({
      claim_id: "clm-archived",
      reason: "should fail",
    })
  );

  runtime.close();
});

test("runtime search ranking reflects outcome-backed promotion and demotion", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-outcome-ranking-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
    id: "clm-neutral",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.backend.neutral",
    cardinality: "singleton",
    content: "Use neutral backend strategy",
    source_event_ids: ["evt-neutral"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  admin.insertClaimRecord({
    id: "clm-negative",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.backend.negative",
    cardinality: "singleton",
    content: "Use JSON backend strategy",
    source_event_ids: ["evt-negative"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  admin.insertClaimRecord({
    id: "clm-positive",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.backend.positive",
    cardinality: "singleton",
    content: "Use SQLite backend strategy",
    source_event_ids: ["evt-positive"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "system_verified",
    status: "active",
  });

  const baseline = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 10,
  });

  const baselineOrder = baseline.active_claims.map((claim) => claim.id);
  const baselinePositiveRank = baselineOrder.indexOf("clm-positive");
  const baselineNegativeRank = baselineOrder.indexOf("clm-negative");

  admin.insertOutcomeRecord({
    id: "out-positive-1",
    ts: "2026-03-12T01:00:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-positive-outcome"],
    related_claim_ids: ["clm-positive"],
    outcome_type: "test_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-positive-2",
    ts: "2026-03-12T01:10:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-positive-outcome-2"],
    related_claim_ids: ["clm-positive"],
    outcome_type: "commit_kept",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-negative-1",
    ts: "2026-03-12T01:20:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-negative-outcome"],
    related_claim_ids: ["clm-negative"],
    outcome_type: "manual_override",
    strength: 1,
  });

  const afterOutcomes = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 10,
  });

  const outcomeOrder = afterOutcomes.active_claims.map((claim) => claim.id);
  const positiveRank = outcomeOrder.indexOf("clm-positive");
  const neutralRank = outcomeOrder.indexOf("clm-neutral");
  const negativeRank = outcomeOrder.indexOf("clm-negative");

  assert.ok(positiveRank !== -1);
  assert.ok(neutralRank !== -1);
  assert.ok(negativeRank !== -1);
  assert.ok(positiveRank < neutralRank);
  assert.ok(neutralRank < negativeRank);
  assert.ok(positiveRank < baselinePositiveRank);
  assert.ok(negativeRank > baselineNegativeRank);

  runtime.close();
});

test("runtime extracts high-value hinted claim families deterministically", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-family-hints-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });

  runtime.recordEvent({
    id: "evt-strategy",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    content: "Current strategy is to stabilize Windows install path handling first",
    metadata: {
      memory_hints: {
        family_hint: "current_strategy",
        canonical_key_hint: "windows.install",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-blocker",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "user",
    agent_version: "unknown",
    event_type: "user_message",
    content: "Windows path normalization is blocking reliable install tests",
    metadata: {
      memory_hints: {
        family_hint: "blocker",
        canonical_key_hint: "windows.install",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-rejected",
    ts: "2026-03-12T00:00:02.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    content: "Do not go back to JSON-based persistence",
    metadata: {
      memory_hints: {
        family_hint: "rejected_strategy",
        canonical_key_hint: "persistence.backend",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-question",
    ts: "2026-03-12T00:00:03.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "user",
    agent_version: "unknown",
    event_type: "user_message",
    content: "Should path normalization happen before or after package extraction?",
    metadata: {
      memory_hints: {
        family_hint: "open_question",
        canonical_key_hint: "windows.install.order",
      },
    },
  });

  const claims = runtime.listClaims("github.com/acme/demo");
  assert.ok(
    claims.some((claim) => claim.canonical_key === "decision.current_strategy.windows.install")
  );
  assert.ok(claims.some((claim) => claim.canonical_key === "thread.blocker.windows.install"));
  assert.ok(
    claims.some((claim) => claim.canonical_key === "decision.rejected_strategy.persistence.backend")
  );
  assert.ok(
    claims.some((claim) => claim.canonical_key === "thread.open_question.windows.install.order")
  );

  const brief = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: {},
  });
  assert.ok(
    brief.active_claims.some((claim) => claim.canonical_key === "decision.current_strategy.windows.install")
  );
  assert.ok(
    brief.open_threads.some((claim) => claim.canonical_key === "thread.blocker.windows.install")
  );

  runtime.recordEvent({
    id: "evt-blocker-agent",
    ts: "2026-03-12T00:00:04.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "agent_message",
    content: "Agent claims this is a blocker",
    metadata: {
      memory_hints: {
        family_hint: "blocker",
        canonical_key_hint: "agent.injected",
      },
    },
  });

  const claimsAfterAgentHint = runtime.listClaims("github.com/acme/demo");
  assert.ok(
    !claimsAfterAgentHint.some((claim) => claim.canonical_key === "thread.blocker.agent.injected")
  );

  runtime.close();
});
