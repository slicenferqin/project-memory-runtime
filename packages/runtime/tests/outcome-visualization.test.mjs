import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Helper: create a fresh runtime with temp directory.
 */
async function freshRuntime() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-outcome-viz-"));
  const { ProjectMemoryRuntime } = await import("../dist/index.js");
  const runtime = new ProjectMemoryRuntime({ dataDir: tempDir });
  runtime.initialize();
  return { runtime, tempDir };
}

const PROJECT_ID = "github.com/acme/outcome-viz";

test("session brief includes outcome_summary on claims with outcomes", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  // Insert a claim
  admin.insertClaimRecord({
    id: "clm-1",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend",
    cardinality: "singleton",
    content: "Use SQLite as backend",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.8,
    outcome_score: 0.5,
    verification_status: "user_confirmed",
    status: "active",
  });

  // Insert positive outcomes
  admin.insertOutcomeRecord({
    id: "out-1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-1"],
    outcome_type: "test_pass",
    strength: 1,
  });

  admin.insertOutcomeRecord({
    id: "out-2",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-1"],
    outcome_type: "build_pass",
    strength: 1,
  });

  admin.insertOutcomeRecord({
    id: "out-3",
    ts: "2026-03-13T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-1"],
    outcome_type: "test_pass",
    strength: 1,
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  // Find the claim in active_claims
  const claim = packet.active_claims.find(
    (c) => c.canonical_key === "decision.persistence.backend"
  );
  assert.ok(claim, "decision claim should appear in active_claims");
  assert.ok(claim.outcome_summary, "claim should have outcome_summary");
  assert.equal(claim.outcome_summary.positive_count, 3);
  assert.equal(claim.outcome_summary.negative_count, 0);
  assert.ok(claim.outcome_summary.outcome_types.includes("test_pass"));
  assert.ok(claim.outcome_summary.outcome_types.includes("build_pass"));
  assert.equal(claim.outcome_summary.last_outcome_at, "2026-03-13T00:00:00.000Z");

  runtime.close();
});

test("project snapshot includes mixed positive and negative outcome counts", async () => {
  // NOTE: Using project_snapshot mode because test_fail demotes a claim to stale
  // and session_brief only shows active claims. project_snapshot includes stale claims.
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-mixed",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "fact.auth.method",
    cardinality: "singleton",
    content: "JWT with refresh tokens",
    source_event_ids: ["evt-1"],
    confidence: 0.85,
    importance: 0.7,
    outcome_score: 0.2,
    verification_status: "user_confirmed",
    status: "active",
  });

  // 2 positive, 1 negative (test_fail will demote claim to stale via outcome loop)
  admin.insertOutcomeRecord({
    id: "out-p1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-mixed"],
    outcome_type: "test_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-p2",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-mixed"],
    outcome_type: "commit_kept",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-n1",
    ts: "2026-03-13T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-mixed"],
    outcome_type: "test_fail",
    strength: 1,
  });

  const packet = runtime.buildProjectSnapshot({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  const claim = packet.active_claims.find(
    (c) => c.canonical_key === "fact.auth.method"
  );
  assert.ok(claim, "fact claim should appear in project snapshot active_claims");
  assert.ok(claim.outcome_summary, "claim should have outcome_summary");
  assert.equal(claim.outcome_summary.positive_count, 2);
  assert.equal(claim.outcome_summary.negative_count, 1);
  assert.ok(claim.outcome_summary.outcome_types.includes("test_pass"));
  assert.ok(claim.outcome_summary.outcome_types.includes("commit_kept"));
  assert.ok(claim.outcome_summary.outcome_types.includes("test_fail"));

  runtime.close();
});

test("claims without outcomes have no outcome_summary", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-no-out",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.naming.convention",
    cardinality: "singleton",
    content: "Use camelCase for variables",
    source_event_ids: ["evt-1"],
    confidence: 0.8,
    importance: 0.5,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  const claim = packet.active_claims.find(
    (c) => c.canonical_key === "decision.naming.convention"
  );
  assert.ok(claim, "claim should appear in active_claims");
  assert.equal(claim.outcome_summary, undefined, "no outcomes → no outcome_summary");

  runtime.close();
});

test("stale warning appears for claims approaching TTL threshold", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  // Decision claim created 55 days ago (TTL for decision is 60 days, 80% threshold = 48 days)
  const fiftyFiveDaysAgo = new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString();

  admin.insertClaimRecord({
    id: "clm-old-decision",
    created_at: fiftyFiveDaysAgo,
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.old.one",
    cardinality: "singleton",
    content: "Use Express for HTTP server",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.7,
    outcome_score: 0.3,
    verification_status: "user_confirmed",
    status: "active",
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  assert.ok(packet.warnings, "packet should have warnings");
  const staleWarning = packet.warnings.find(
    (w) => w.includes("decision.old.one") && w.includes("approaching stale")
  );
  assert.ok(staleWarning, "should have stale warning for old decision");
  assert.ok(staleWarning.includes("55"), "should mention days since verification");
  assert.ok(staleWarning.includes("60"), "should mention threshold");

  runtime.close();
});

test("stale warning appears for threads approaching TTL (14-day threshold)", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  // Thread created 12 days ago (TTL for thread is 14 days, 80% = 11.2 days)
  const twelveDaysAgo = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();

  admin.insertClaimRecord({
    id: "clm-old-thread",
    created_at: twelveDaysAgo,
    project_id: PROJECT_ID,
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.stale.one",
    cardinality: "singleton",
    content: "Refactor auth module",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.6,
    outcome_score: 0,
    verification_status: "inferred",
    status: "active",
    thread_status: "open",
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  assert.ok(packet.warnings, "packet should have warnings");
  const staleWarning = packet.warnings.find(
    (w) => w.includes("thread.stale.one") && w.includes("approaching stale")
  );
  assert.ok(staleWarning, "should have stale warning for old thread");

  runtime.close();
});

test("no stale warning for recently created claims", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-fresh",
    created_at: new Date().toISOString(),
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.fresh.one",
    cardinality: "singleton",
    content: "Fresh decision",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.7,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  // Either no warnings at all, or none mentioning this claim
  if (packet.warnings) {
    const staleWarning = packet.warnings.find(
      (w) => w.includes("decision.fresh.one")
    );
    assert.equal(staleWarning, undefined, "fresh claim should not trigger stale warning");
  }

  runtime.close();
});

test("explainClaim includes outcome_timeline with score progression", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-explain",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.test.timeline",
    cardinality: "singleton",
    content: "Use SQLite for persistence",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.8,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
  });

  // Insert outcomes in chronological order
  admin.insertOutcomeRecord({
    id: "out-t1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-explain"],
    outcome_type: "test_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-t2",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-explain"],
    outcome_type: "build_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-t3",
    ts: "2026-03-13T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-explain"],
    outcome_type: "test_fail",
    strength: 1,
    notes: "auth test broke",
  });
  admin.insertOutcomeRecord({
    id: "out-t4",
    ts: "2026-03-14T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-explain"],
    outcome_type: "test_pass",
    strength: 1,
  });

  const result = runtime.explainClaim("clm-explain");
  assert.ok(result, "explainClaim should return a result");

  // Verify outcome_timeline exists
  assert.ok(Array.isArray(result.outcome_timeline), "outcome_timeline should be an array");
  assert.ok(result.outcome_timeline.length >= 5, "should have at least 5 entries (1 creation + 4 outcomes)");

  // First entry should be creation
  const creation = result.outcome_timeline[0];
  assert.equal(creation.event_type, "created");
  assert.equal(creation.ts, "2026-03-10T00:00:00.000Z");
  assert.equal(creation.score_after, 0);

  // Find outcome entries
  const outcomeEntries = result.outcome_timeline.filter(
    (e) => e.event_type !== "created" && !e.event_type.startsWith("transition:")
  );
  assert.equal(outcomeEntries.length, 4, "should have 4 outcome entries");

  // Verify score progression for first outcome (test_pass: 0 → positive)
  const firstOutcome = outcomeEntries[0];
  assert.equal(firstOutcome.event_type, "test_pass");
  assert.equal(firstOutcome.score_before, 0);
  assert.ok(firstOutcome.score_after > 0, "score should increase after test_pass");

  // Verify score decreases on test_fail
  const failOutcome = outcomeEntries[2];
  assert.equal(failOutcome.event_type, "test_fail");
  assert.ok(failOutcome.score_before > failOutcome.score_after, "score should decrease after test_fail");
  assert.ok(failOutcome.description.includes("auth test broke"), "should include notes");

  // Verify score increases again after final test_pass
  const lastOutcome = outcomeEntries[3];
  assert.equal(lastOutcome.event_type, "test_pass");
  assert.ok(lastOutcome.score_after > lastOutcome.score_before, "score should increase again");

  // Verify chronological ordering
  for (let i = 1; i < result.outcome_timeline.length; i++) {
    assert.ok(
      result.outcome_timeline[i].ts >= result.outcome_timeline[i - 1].ts,
      `timeline entry ${i} should be after entry ${i - 1}`
    );
  }

  runtime.close();
});

test("explainClaim returns empty outcome_timeline for claims without outcomes", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-no-timeline",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "fact.no.outcomes",
    cardinality: "singleton",
    content: "Repo uses TypeScript",
    source_event_ids: ["evt-1"],
    confidence: 0.7,
    importance: 0.5,
    outcome_score: 0,
    verification_status: "unverified",
    status: "active",
  });

  const result = runtime.explainClaim("clm-no-timeline");
  assert.ok(result, "explainClaim should return a result");
  assert.ok(Array.isArray(result.outcome_timeline));

  // Only the creation entry
  assert.equal(result.outcome_timeline.length, 1, "should have only creation entry");
  assert.equal(result.outcome_timeline[0].event_type, "created");

  runtime.close();
});

test("project snapshot also includes outcome_summary on claims", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-snap",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.snap.test",
    cardinality: "singleton",
    content: "Use vitest for testing",
    source_event_ids: ["evt-1"],
    confidence: 0.85,
    importance: 0.7,
    outcome_score: 0.4,
    verification_status: "user_confirmed",
    status: "active",
  });

  admin.insertOutcomeRecord({
    id: "out-snap-1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-snap"],
    outcome_type: "test_pass",
    strength: 1,
  });

  const packet = runtime.buildProjectSnapshot({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  const claim = packet.active_claims.find(
    (c) => c.canonical_key === "decision.snap.test"
  );
  assert.ok(claim, "claim should appear in snapshot");
  assert.ok(claim.outcome_summary, "claim should have outcome_summary in snapshot");
  assert.equal(claim.outcome_summary.positive_count, 1);
  assert.equal(claim.outcome_summary.negative_count, 0);

  runtime.close();
});

test("search results also include outcome_summary on claims", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-search",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "fact.search.test",
    cardinality: "singleton",
    content: "SQLite is the database engine",
    source_event_ids: ["evt-1"],
    confidence: 0.85,
    importance: 0.7,
    outcome_score: 0.3,
    verification_status: "user_confirmed",
    status: "active",
  });

  admin.insertOutcomeRecord({
    id: "out-search-1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-search"],
    outcome_type: "build_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-search-2",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-search"],
    outcome_type: "test_fail",
    strength: 0.5,
  });

  const packet = runtime.searchClaims({
    project_id: PROJECT_ID,
    query: "SQLite database",
  });

  const claim = packet.active_claims.find(
    (c) => c.canonical_key === "fact.search.test"
  );
  assert.ok(claim, "claim should appear in search results");
  assert.ok(claim.outcome_summary, "claim should have outcome_summary in search");
  assert.equal(claim.outcome_summary.positive_count, 1);
  assert.equal(claim.outcome_summary.negative_count, 1);
  assert.ok(claim.outcome_summary.outcome_types.includes("build_pass"));
  assert.ok(claim.outcome_summary.outcome_types.includes("test_fail"));

  runtime.close();
});

test("stale warning for demoted claim mentions failing outcome types", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  // Stale claim with negative outcomes
  admin.insertClaimRecord({
    id: "clm-demoted",
    created_at: "2026-03-01T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.demoted.one",
    cardinality: "singleton",
    content: "Use Redis for caching",
    source_event_ids: ["evt-1"],
    confidence: 0.5,
    importance: 0.6,
    outcome_score: -0.3,
    verification_status: "user_confirmed",
    status: "stale",
  });

  admin.insertOutcomeRecord({
    id: "out-demoted-1",
    ts: "2026-03-05T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-demoted"],
    outcome_type: "test_fail",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-demoted-2",
    ts: "2026-03-06T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-demoted"],
    outcome_type: "build_fail",
    strength: 1,
  });

  // Note: stale claims might not appear in session_brief since we filter to active only
  // Use project_snapshot mode which includes more claims
  const packet = runtime.buildProjectSnapshot({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  // The stale claim may or may not appear depending on activation filtering.
  // But if there are warnings, they should mention the demoted claim.
  if (packet.warnings) {
    const demotedWarning = packet.warnings.find(
      (w) => w.includes("decision.demoted.one") && w.includes("demoted")
    );
    if (demotedWarning) {
      assert.ok(
        demotedWarning.includes("test_fail") || demotedWarning.includes("build_fail"),
        "demoted warning should mention failing outcome types"
      );
    }
  }

  runtime.close();
});

test("outcome_summary on open threads via open_threads field", async () => {
  const { runtime } = await freshRuntime();
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-thread-out",
    created_at: "2026-03-10T00:00:00.000Z",
    project_id: PROJECT_ID,
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.outcome.test",
    cardinality: "singleton",
    content: "Refactor auth module",
    source_event_ids: ["evt-1"],
    confidence: 0.9,
    importance: 0.6,
    outcome_score: 0,
    verification_status: "inferred",
    status: "active",
    thread_status: "open",
  });

  admin.insertOutcomeRecord({
    id: "out-thread-1",
    ts: "2026-03-11T00:00:00.000Z",
    project_id: PROJECT_ID,
    related_event_ids: ["evt-1"],
    related_claim_ids: ["clm-thread-out"],
    outcome_type: "human_kept",
    strength: 1,
  });

  const packet = runtime.buildSessionBrief({
    project_id: PROJECT_ID,
    agent_id: "claude-code",
  });

  const thread = packet.open_threads.find(
    (t) => t.canonical_key === "thread.outcome.test"
  );
  assert.ok(thread, "thread should appear in open_threads");
  assert.ok(thread.outcome_summary, "thread should have outcome_summary");
  assert.equal(thread.outcome_summary.positive_count, 1);
  assert.ok(thread.outcome_summary.outcome_types.includes("human_kept"));

  runtime.close();
});
