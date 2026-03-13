import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeEntry = path.join(repoRoot, "packages/runtime/dist/index.js");
const cliPath = path.join(repoRoot, "tools/memoryctl/cli.mjs");

function runMemoryctl(args, cwd = repoRoot) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `memoryctl failed: ${args.join(" ")}`);
  }

  return result.stdout.trim();
}

test("memoryctl inspects claims and verifies a claim", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-memoryctl-"));
  const { ProjectMemoryRuntime } = await import(runtimeEntry);

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  const admin = runtime.getAdminApi();
  runtime.initialize();

  admin.insertClaimRecord({
    id: "clm-memoryctl",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend",
    cardinality: "singleton",
    content: "Use SQLite backend",
    source_event_ids: ["evt-memoryctl"],
    confidence: 0.8,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "inferred",
    status: "active",
  });

  const claimsJson = runMemoryctl(
    ["inspect", "claims", "--data-dir", tempDir, "--project", "github.com/acme/demo", "--json"],
    repoRoot
  );
  const claims = JSON.parse(claimsJson);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, "clm-memoryctl");

  const verifyJson = runMemoryctl(
    [
      "verify",
      "clm-memoryctl",
      "--data-dir",
      tempDir,
      "--status",
      "system_verified",
      "--method",
      "memoryctl_smoke",
      "--json",
    ],
    repoRoot
  );
  const verifiedClaim = JSON.parse(verifyJson);
  assert.equal(verifiedClaim.verification_status, "system_verified");
  assert.equal(verifiedClaim.verification_method, "memoryctl_smoke");

  runtime.close();
});

test("memoryctl explains a claim and renders snapshot output", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-memoryctl-explain-"));
  const { ProjectMemoryRuntime } = await import(runtimeEntry);

  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.recordEvent({
    id: "evt-issue",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "issue_link",
    content: "Tracking issue #42",
    metadata: { issue_id: "42" },
  });

  const threadClaim = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "thread.issue.42");
  assert.ok(threadClaim);

  const explanationJson = runMemoryctl(
    ["explain-claim", threadClaim.id, "--data-dir", tempDir, "--json"],
    repoRoot
  );
  const explanation = JSON.parse(explanationJson);
  assert.equal(explanation.claim.canonical_key, "thread.issue.42");

  const snapshotOutput = runMemoryctl(
    ["snapshot", "--data-dir", tempDir, "--project", "github.com/acme/demo"],
    repoRoot
  );
  assert.ok(snapshotOutput.includes("active_claims="));
  assert.ok(snapshotOutput.includes("open_threads="));

  runtime.close();
});
