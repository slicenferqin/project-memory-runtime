import test from "node:test";
import assert from "node:assert/strict";

/**
 * Helper: create a minimal test claim with sensible defaults.
 */
function makeClaim(overrides = {}) {
  return {
    id: "clm-default",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/test",
    type: "fact",
    assertion_kind: "fact",
    canonical_key: "test.key",
    cardinality: "singleton",
    content: "A test claim",
    source_event_ids: ["evt-1"],
    confidence: 0.8,
    importance: 0.5,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
    pinned: false,
    ...overrides,
  };
}

const PROJECT_ID = "github.com/acme/test";

let activateClaims;
let scopeCompatible;

test("load activation engine module", async () => {
  const mod = await import("../dist/activation/engine.js");
  activateClaims = mod.activateClaims;
  scopeCompatible = mod.scopeCompatible;
  assert.ok(typeof activateClaims === "function");
  assert.ok(typeof scopeCompatible === "function");
});

test("eligible active claims are selected", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-1" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].id, "clm-1");
  assert.equal(result.filtered.length, 0);
  assert.equal(result.dropped.length, 0);
});

test("project_mismatch filters out claims from other projects", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-wrong", project_id: "github.com/other/repo" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "project_mismatch");
});

test("superseded claims are filtered", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-sup", status: "superseded" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "superseded");
});

test("archived claims are filtered", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-arch", status: "archived" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "archived");
});

test("expired claims (valid_to in past) are filtered", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-exp", valid_to: "2020-01-01T00:00:00.000Z" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "expired");
});

test("disputed claims are filtered", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-disp", verification_status: "disputed" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "verification_guard");
});

test("unverified claims are filtered in session_brief mode", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-unv", verification_status: "unverified" })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "verification_guard");
});

test("unverified claims are allowed in project_snapshot mode", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-unv", verification_status: "unverified" })],
    mode: "project_snapshot",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].id, "clm-unv");
});

test("unverified claims are allowed in search mode", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-unv", verification_status: "unverified" })],
    mode: "search",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 1);
});

test("scope_mismatch filters claims from incompatible repos", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-scope", scope: { repo: "github.com/other/repo" } })],
    scope: { repo: "github.com/acme/test" },
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].suppression_reason, "scope_mismatch");
});

test("resolved threads are filtered by default", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [
      makeClaim({
        id: "clm-resolved",
        type: "thread",
        assertion_kind: "todo",
        thread_status: "resolved",
        verification_status: "inferred",
      }),
    ],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 0);
});

test("resolved threads are included when includeResolvedThreads is true", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [
      makeClaim({
        id: "clm-resolved",
        type: "thread",
        assertion_kind: "todo",
        thread_status: "resolved",
        verification_status: "inferred",
      }),
    ],
    mode: "session_brief",
    maxItems: 10,
    includeResolvedThreads: true,
  });

  assert.equal(result.selected.length, 1);
});

test("maxItems enforces token budget — excess claims get token_budget suppression", async () => {
  const claims = Array.from({ length: 5 }, (_, i) =>
    makeClaim({
      id: `clm-${i}`,
      canonical_key: `key.${i}`,
      confidence: 0.9 - i * 0.1,
    })
  );

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 3,
  });

  assert.equal(result.selected.length, 3);
  assert.equal(result.dropped.length, 2);
  // At least one dropped claim should have token_budget reason
  const budgetDropped = result.dropped.filter(
    (d) => d.suppression_reason === "token_budget"
  );
  assert.ok(budgetDropped.length > 0, "should have at least one token_budget drop");
});

test("singleton dedup: same canonical_key → only one selected", async () => {
  const claims = [
    makeClaim({
      id: "clm-a",
      canonical_key: "decision.test",
      cardinality: "singleton",
      content: "Version A",
    }),
    makeClaim({
      id: "clm-b",
      canonical_key: "decision.test",
      cardinality: "singleton",
      content: "Version B",
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].suppression_reason, "low_rank");
});

test("set cardinality claims can appear multiple times for same canonical_key", async () => {
  const claims = [
    makeClaim({
      id: "clm-s1",
      canonical_key: "fact.files",
      cardinality: "set",
      content: "File A",
    }),
    makeClaim({
      id: "clm-s2",
      canonical_key: "fact.files",
      cardinality: "set",
      content: "File B",
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
    maxPerCanonicalKey: 3,
  });

  assert.equal(result.selected.length, 2);
});

test("priority bucket: pinned decisions rank above threads above verified above rest", async () => {
  const claims = [
    makeClaim({
      id: "clm-rest",
      type: "fact",
      canonical_key: "fact.rest",
      verification_status: "inferred",
      confidence: 1.0,
      importance: 1.0,
    }),
    makeClaim({
      id: "clm-verified",
      type: "fact",
      canonical_key: "fact.verified",
      verification_status: "user_confirmed",
      confidence: 0.5,
      importance: 0.5,
    }),
    makeClaim({
      id: "clm-thread",
      type: "thread",
      assertion_kind: "todo",
      canonical_key: "thread.open",
      verification_status: "inferred",
      confidence: 0.3,
      importance: 0.3,
      thread_status: "open",
    }),
    makeClaim({
      id: "clm-pinned",
      type: "decision",
      assertion_kind: "instruction",
      canonical_key: "decision.pinned",
      verification_status: "user_confirmed",
      pinned: true,
      confidence: 0.1,
      importance: 0.1,
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 4);
  // Order: pinned decision (bucket 0) → thread (1) → verified (2) → rest (3)
  assert.equal(result.selected[0].id, "clm-pinned");
  assert.equal(result.selected[1].id, "clm-thread");
  assert.equal(result.selected[2].id, "clm-verified");
  assert.equal(result.selected[3].id, "clm-rest");
});

test("higher confidence claims rank above lower confidence within same bucket", async () => {
  const claims = [
    makeClaim({
      id: "clm-low",
      canonical_key: "fact.low",
      confidence: 0.3,
    }),
    makeClaim({
      id: "clm-high",
      canonical_key: "fact.high",
      confidence: 0.95,
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 2);
  assert.equal(result.selected[0].id, "clm-high");
  assert.equal(result.selected[1].id, "clm-low");
});

test("positive outcome_score increases rank", async () => {
  const claims = [
    makeClaim({
      id: "clm-zero",
      canonical_key: "fact.zero",
      outcome_score: 0,
      confidence: 0.8,
    }),
    makeClaim({
      id: "clm-positive",
      canonical_key: "fact.positive",
      outcome_score: 0.8,
      confidence: 0.8,
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 2);
  assert.equal(result.selected[0].id, "clm-positive");
  assert.equal(result.selected[1].id, "clm-zero");
});

test("text search matches boost relevance in search mode", async () => {
  const claims = [
    makeClaim({
      id: "clm-irrelevant",
      canonical_key: "fact.something.else",
      content: "This is about bananas",
    }),
    makeClaim({
      id: "clm-relevant",
      canonical_key: "fact.sqlite.backend",
      content: "Use SQLite for data persistence",
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "search",
    query: "SQLite persistence",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 2);
  // The SQLite claim should rank higher because the query matches
  assert.equal(result.selected[0].id, "clm-relevant");
});

test("fresher claims rank above older claims within same bucket", async () => {
  const now = "2026-03-23T00:00:00.000Z";
  const claims = [
    makeClaim({
      id: "clm-old",
      canonical_key: "fact.old",
      created_at: "2025-01-01T00:00:00.000Z",
      confidence: 0.8,
    }),
    makeClaim({
      id: "clm-fresh",
      canonical_key: "fact.fresh",
      created_at: "2026-03-22T00:00:00.000Z",
      confidence: 0.8,
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
    now,
  });

  assert.equal(result.selected.length, 2);
  assert.equal(result.selected[0].id, "clm-fresh");
  assert.equal(result.selected[1].id, "clm-old");
});

test("scope specificity: more specific scope claims rank higher", async () => {
  const claims = [
    makeClaim({
      id: "clm-global",
      canonical_key: "fact.global",
      scope: undefined,
      confidence: 0.8,
    }),
    makeClaim({
      id: "clm-scoped",
      canonical_key: "fact.scoped",
      scope: { repo: "github.com/acme/test", branch: "main" },
      confidence: 0.8,
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    scope: { repo: "github.com/acme/test", branch: "main" },
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 2);
  assert.equal(result.selected[0].id, "clm-scoped");
  assert.equal(result.selected[1].id, "clm-global");
});

test("scopeCompatible returns true when both scopes are undefined", async () => {
  assert.ok(scopeCompatible(undefined, undefined));
});

test("scopeCompatible returns true when claim scope is undefined", async () => {
  assert.ok(scopeCompatible(undefined, { repo: "github.com/acme/test" }));
});

test("scopeCompatible returns true when request scope is undefined", async () => {
  assert.ok(scopeCompatible({ repo: "github.com/acme/test" }, undefined));
});

test("scopeCompatible returns false for repo mismatch", async () => {
  assert.equal(
    scopeCompatible(
      { repo: "github.com/acme/test" },
      { repo: "github.com/other/repo" }
    ),
    false
  );
});

test("scopeCompatible returns false for branch mismatch", async () => {
  assert.equal(
    scopeCompatible(
      { repo: "github.com/acme/test", branch: "main" },
      { repo: "github.com/acme/test", branch: "feature" }
    ),
    false
  );
});

test("scopeCompatible returns true for matching repo and branch", async () => {
  assert.ok(
    scopeCompatible(
      { repo: "github.com/acme/test", branch: "main" },
      { repo: "github.com/acme/test", branch: "main" }
    )
  );
});

test("recall_rank is assigned in order of selection", async () => {
  const claims = Array.from({ length: 3 }, (_, i) =>
    makeClaim({
      id: `clm-${i}`,
      canonical_key: `key.${i}`,
      confidence: 0.9 - i * 0.1,
    })
  );

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected[0].recall_rank, 1);
  assert.equal(result.selected[1].recall_rank, 2);
  assert.equal(result.selected[2].recall_rank, 3);
});

test("activation_reasons include relevant debug info", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [
      makeClaim({
        id: "clm-1",
        pinned: true,
        type: "thread",
        assertion_kind: "todo",
        thread_status: "open",
        verification_status: "user_confirmed",
      }),
    ],
    mode: "session_brief",
    maxItems: 10,
  });

  const reasons = result.selected[0].activation_reasons;
  assert.ok(reasons.some((r) => r.startsWith("relevance:")));
  assert.ok(reasons.some((r) => r.startsWith("freshness:")));
  assert.ok(reasons.some((r) => r.startsWith("scope:")));
  assert.ok(reasons.includes("pinned"));
  assert.ok(reasons.includes("thread:open"));
  assert.ok(reasons.some((r) => r.includes("user_confirmed")));
});

test("evidence_refs are populated from source_event_ids", async () => {
  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims: [makeClaim({ id: "clm-1", source_event_ids: ["evt-a", "evt-b"] })],
    mode: "session_brief",
    maxItems: 10,
  });

  assert.deepEqual(result.selected[0].evidence_refs, ["evt-a", "evt-b"]);
});

test("mode differences: session_brief gives decisions higher base relevance than facts", async () => {
  const claims = [
    makeClaim({
      id: "clm-fact",
      type: "fact",
      canonical_key: "fact.test",
      confidence: 0.8,
    }),
    makeClaim({
      id: "clm-decision",
      type: "decision",
      assertion_kind: "instruction",
      canonical_key: "decision.test",
      confidence: 0.8,
    }),
  ];

  const briefResult = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  // Both in same verification bucket, decision should rank higher due to higher base relevance
  assert.equal(briefResult.selected[0].id, "clm-decision");
  assert.equal(briefResult.selected[1].id, "clm-fact");
});

test("stale claims have lower base relevance in session_brief", async () => {
  const claims = [
    makeClaim({
      id: "clm-active",
      canonical_key: "fact.active",
      status: "active",
      confidence: 0.7,
      verification_status: "inferred",
    }),
    makeClaim({
      id: "clm-stale",
      canonical_key: "fact.stale",
      status: "stale",
      confidence: 0.7,
      verification_status: "inferred",
    }),
  ];

  const result = activateClaims({
    projectId: PROJECT_ID,
    agentId: "test",
    claims,
    mode: "session_brief",
    maxItems: 10,
  });

  assert.equal(result.selected.length, 2);
  assert.equal(result.selected[0].id, "clm-active");
  assert.equal(result.selected[1].id, "clm-stale");
});
