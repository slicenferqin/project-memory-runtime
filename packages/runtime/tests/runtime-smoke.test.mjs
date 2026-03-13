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
