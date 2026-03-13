import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { ProjectMemoryRuntime } from "../../packages/runtime/dist/index.js";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRuntime(prefix) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const runtime = new ProjectMemoryRuntime({ dataDir });
  runtime.initialize();
  return runtime;
}

function round(value) {
  return Number(value.toFixed(4));
}

function canonicalKeys(claims) {
  return claims.map((claim) => claim.canonical_key);
}

function computeRecall(found, expected) {
  const foundSet = new Set(found);
  const hits = expected.filter((key) => foundSet.has(key)).length;
  return {
    hits,
    total: expected.length,
    recall: expected.length === 0 ? 1 : hits / expected.length,
  };
}

function rankById(packet) {
  const ranks = new Map();
  packet.active_claims.forEach((claim, index) => ranks.set(claim.id, index));
  return ranks;
}

function runSessionRecoveryBenchmark() {
  const runtime = createRuntime("pmr-bench-session-");

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

  const packet = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-session-recovery",
    scope: { branch: "fix/windows-install" },
  });

  const activeExpected = [
    "repo.package_manager",
    "repo.test_framework",
    "decision.avoid.decision.persistence.backend",
  ];
  const threadExpected = [
    "thread.issue.42",
    "thread.test.windows.install.path.normalizer",
    "thread.branch.fix.windows.install",
  ];

  const activeRecall = computeRecall(canonicalKeys(packet.active_claims), activeExpected);
  const threadRecall = computeRecall(canonicalKeys(packet.open_threads), threadExpected);
  const pass = activeRecall.recall >= 0.66 && threadRecall.recall >= 0.8;

  runtime.close();

  return {
    name: "session_recovery",
    pass,
    metrics: {
      active_claim_recall: round(activeRecall.recall),
      open_thread_recall: round(threadRecall.recall),
      active_claim_hits: activeRecall.hits,
      open_thread_hits: threadRecall.hits,
    },
    packet: {
      brief: packet.brief,
      active_claim_keys: canonicalKeys(packet.active_claims),
      open_thread_keys: canonicalKeys(packet.open_threads),
    },
  };
}

function runStaleSuppressionBenchmark() {
  const runtime = createRuntime("pmr-bench-stale-");
  const admin = runtime.getAdminApi();

  admin.insertClaimRecord({
    id: "clm-active",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend.active",
    cardinality: "singleton",
    content: "Use SQLite backend strategy",
    source_event_ids: ["evt-active"],
    confidence: 0.85,
    importance: 0.85,
    outcome_score: 0.2,
    verification_status: "user_confirmed",
    status: "active",
  });
  admin.insertClaimRecord({
    id: "clm-stale",
    created_at: "2026-01-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend.stale",
    cardinality: "singleton",
    content: "Use JSON backend strategy",
    source_event_ids: ["evt-stale"],
    confidence: 0.7,
    importance: 0.7,
    outcome_score: -0.3,
    verification_status: "inferred",
    status: "stale",
  });
  admin.insertClaimRecord({
    id: "clm-superseded",
    created_at: "2026-02-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "decision",
    assertion_kind: "instruction",
    canonical_key: "decision.persistence.backend.superseded",
    cardinality: "singleton",
    content: "Use flat-file backend strategy",
    source_event_ids: ["evt-superseded"],
    confidence: 0.75,
    importance: 0.75,
    outcome_score: 0,
    verification_status: "inferred",
    status: "superseded",
  });

  const packet = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 10,
  });

  const activeKeys = canonicalKeys(packet.active_claims);
  const staleIndex = activeKeys.indexOf("decision.persistence.backend.stale");
  const activeIndex = activeKeys.indexOf("decision.persistence.backend.active");
  const supersededLeakage = activeKeys.includes("decision.persistence.backend.superseded") ? 1 : 0;
  const pass = supersededLeakage === 0 && activeIndex !== -1 && (staleIndex === -1 || activeIndex < staleIndex);

  runtime.close();

  return {
    name: "stale_suppression",
    pass,
    metrics: {
      superseded_leakage: supersededLeakage,
      stale_selected: staleIndex === -1 ? 0 : 1,
      active_replacement_rank: activeIndex,
      stale_rank: staleIndex,
    },
    packet: {
      active_claim_keys: activeKeys,
    },
  };
}

function runOutcomeLearningBenchmark() {
  const runtime = createRuntime("pmr-bench-outcome-");
  const admin = runtime.getAdminApi();

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
  const baselineRanks = rankById(baseline);

  admin.insertOutcomeRecord({
    id: "out-positive-1",
    ts: "2026-03-12T01:00:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-positive-outcome-1"],
    related_claim_ids: ["clm-positive"],
    outcome_type: "test_pass",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-positive-2",
    ts: "2026-03-12T01:05:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-positive-outcome-2"],
    related_claim_ids: ["clm-positive"],
    outcome_type: "commit_kept",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-negative-1",
    ts: "2026-03-12T01:10:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-negative-outcome-1"],
    related_claim_ids: ["clm-negative"],
    outcome_type: "manual_override",
    strength: 1,
  });
  admin.insertOutcomeRecord({
    id: "out-negative-2",
    ts: "2026-03-12T01:15:00.000Z",
    project_id: "github.com/acme/demo",
    related_event_ids: ["evt-negative-outcome-2"],
    related_claim_ids: ["clm-negative"],
    outcome_type: "commit_reverted",
    strength: 1,
  });

  const afterOutcomes = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 10,
  });
  const afterRanks = rankById(afterOutcomes);

  const positiveDelta = baselineRanks.get("clm-positive") - afterRanks.get("clm-positive");
  const negativeDelta = afterRanks.get("clm-negative") - baselineRanks.get("clm-negative");
  const pass =
    afterRanks.get("clm-positive") < afterRanks.get("clm-neutral") &&
    afterRanks.get("clm-neutral") < afterRanks.get("clm-negative") &&
    positiveDelta > 0 &&
    negativeDelta > 0;

  runtime.close();

  return {
    name: "outcome_learning",
    pass,
    metrics: {
      positive_rank_delta: positiveDelta,
      negative_rank_delta: negativeDelta,
      final_positive_rank: afterRanks.get("clm-positive"),
      final_neutral_rank: afterRanks.get("clm-neutral"),
      final_negative_rank: afterRanks.get("clm-negative"),
    },
    packet: {
      baseline_order: canonicalKeys(baseline.active_claims),
      final_order: canonicalKeys(afterOutcomes.active_claims),
    },
  };
}

function runMultiAgentConsistencyBenchmark() {
  const runtime = createRuntime("pmr-bench-multi-agent-");

  runtime.recordEvent({
    id: "evt-facts",
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
    id: "evt-decision",
    ts: "2026-03-12T00:00:02.000Z",
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

  const agentA = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: {},
  });
  const agentB = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "codex",
    scope: {},
  });

  const activeA = canonicalKeys(agentA.active_claims).sort();
  const activeB = canonicalKeys(agentB.active_claims).sort();
  const threadsA = canonicalKeys(agentA.open_threads).sort();
  const threadsB = canonicalKeys(agentB.open_threads).sort();
  const pass =
    JSON.stringify(activeA) === JSON.stringify(activeB) &&
    JSON.stringify(threadsA) === JSON.stringify(threadsB);

  runtime.close();

  return {
    name: "multi_agent_consistency",
    pass,
    metrics: {
      active_decision_mismatch: JSON.stringify(activeA) === JSON.stringify(activeB) ? 0 : 1,
      open_thread_divergence: JSON.stringify(threadsA) === JSON.stringify(threadsB) ? 0 : 1,
    },
    packet: {
      agent_a_active_claims: activeA,
      agent_b_active_claims: activeB,
      agent_a_open_threads: threadsA,
      agent_b_open_threads: threadsB,
    },
  };
}

function buildMarkdown(results) {
  const lines = [
    "# Runtime-only Benchmark Summary",
    "",
    `Generated at: ${results.generated_at}`,
    "",
    `Overall: ${results.overall_pass ? "PASS" : "FAIL"}`,
    "",
  ];

  for (const suite of results.suites) {
    lines.push(`## ${suite.name}`);
    lines.push("");
    lines.push(`Status: ${suite.pass ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    for (const [key, value] of Object.entries(suite.metrics)) {
      lines.push(`| ${key} | ${value} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const suites = [
  runSessionRecoveryBenchmark(),
  runStaleSuppressionBenchmark(),
  runOutcomeLearningBenchmark(),
  runMultiAgentConsistencyBenchmark(),
];

const results = {
  generated_at: new Date().toISOString(),
  overall_pass: suites.every((suite) => suite.pass),
  suites,
};

const outputDir = path.join(process.cwd(), "tmp", "benchmarks");
ensureDir(outputDir);

const jsonPath = path.join(outputDir, "runtime-only.latest.json");
const markdownPath = path.join(outputDir, "runtime-only.latest.md");

fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
fs.writeFileSync(markdownPath, buildMarkdown(results));

console.log(JSON.stringify({
  overall_pass: results.overall_pass,
  json: jsonPath,
  markdown: markdownPath,
}, null, 2));
