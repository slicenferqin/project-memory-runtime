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
