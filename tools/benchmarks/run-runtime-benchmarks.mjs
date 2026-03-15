import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { ProjectMemoryRuntime } from "../../packages/runtime/dist/index.js";

if (Number(process.versions.node.split(".")[0]) !== 20) {
  throw new Error(
    `Runtime benchmark requires Node 20.x for the supported native sqlite path. Current version: ${process.versions.node}`
  );
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRuntime(prefix) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const runtime = new ProjectMemoryRuntime({ dataDir });
  runtime.initialize();
  return runtime;
}

function createSharedRuntimePair(prefix) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(dataDir, "runtime.sqlite");
  const writer = new ProjectMemoryRuntime({ dataDir, dbPath });
  const reader = new ProjectMemoryRuntime({ dataDir, dbPath });
  writer.initialize();
  reader.initialize();
  return { writer, reader };
}

function round(value) {
  return Number(value.toFixed(4));
}

function normalizeScope(scope) {
  if (!scope) return null;
  const normalized = {};
  if (scope.repo) normalized.repo = scope.repo;
  if (scope.branch) normalized.branch = scope.branch;
  if (scope.cwd_prefix) normalized.cwd_prefix = scope.cwd_prefix;
  if (scope.files?.length) normalized.files = [...scope.files].sort();
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function scopeSignature(scope) {
  return JSON.stringify(normalizeScope(scope));
}

function claimSignature(claim) {
  return `${claim.canonical_key}@@${scopeSignature(claim.scope)}`;
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

function eventText(event) {
  return event.content.toLowerCase();
}

function rankById(packet) {
  const ranks = new Map();
  packet.active_claims.forEach((claim, index) => ranks.set(claim.id, index));
  return ranks;
}

function requireValue(value, message) {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9/.-]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function textOverlapScore(text, query) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;
  const haystack = new Set(tokenize(text));
  let matches = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) matches += 1;
  }
  return matches / queryTerms.length;
}

function runNoMemorySessionRecoveryBaseline(expectedActive, expectedThreads) {
  const runtime = createRuntime("pmr-bench-no-memory-");
  const packet = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "no-memory-baseline",
    scope: { branch: "fix/windows-install" },
  });

  const activeRecall = computeRecall(
    packet.active_claims.map(claimSignature),
    expectedActive
  );
  const threadRecall = computeRecall(
    packet.open_threads.map(claimSignature),
    expectedThreads
  );
  runtime.close();

  return {
    activeRecall,
    threadRecall,
  };
}

function runKeywordSessionRecoveryBaseline(runtime, expectedActive, expectedThreads) {
  const events = runtime.listEvents("github.com/acme/demo");
  const claims = runtime.listClaims("github.com/acme/demo");
  const rankedActiveEvents = [...events]
    .map((event) => ({
      event,
      score: textOverlapScore(
        eventText(event),
        "current project state default branch package manager persistence baseline install sequencing current branch fix/windows-install"
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.event.ts.localeCompare(right.event.ts))
    .slice(0, 8);

  const rankedThreadEvents = [...events]
    .map((event) => ({
      event,
      score: textOverlapScore(
        eventText(event),
        "open threads current branch focus issue failing test hotfix fix/windows-install windows installer regression"
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.event.ts.localeCompare(right.event.ts))
    .slice(0, 6);

  const activeCandidates = claims.filter((claim) => claim.type !== "thread");
  const threadCandidates = claims.filter((claim) => claim.type === "thread");

  const activeSlotCandidates = new Map();
  const activeSlotOrder = [];
  for (const { event } of rankedActiveEvents) {
    const linkedClaims = activeCandidates.filter((claim) => claim.source_event_ids.includes(event.id));
    for (const claim of linkedClaims) {
      const slot = claim.canonical_key;
      if (!activeSlotCandidates.has(slot)) {
        activeSlotCandidates.set(slot, new Set());
        activeSlotOrder.push(slot);
      }
      activeSlotCandidates.get(slot).add(claimSignature(claim));
    }
  }

  const activeFound = [];
  for (const slot of activeSlotOrder) {
    const signatures = [...activeSlotCandidates.get(slot)];
    // Raw keyword retrieval cannot disambiguate a singleton slot if multiple scoped/state variants surface.
    if (signatures.length === 1) activeFound.push(signatures[0]);
  }

  const threadFound = [];
  const seenThreadSignatures = new Set();
  for (const { event } of rankedThreadEvents) {
    const linkedClaims = threadCandidates.filter((claim) => claim.source_event_ids.includes(event.id));
    for (const claim of linkedClaims) {
      const signature = claimSignature(claim);
      if (seenThreadSignatures.has(signature)) continue;
      seenThreadSignatures.add(signature);
      threadFound.push(signature);
    }
  }

  return {
    activeRecall: computeRecall(activeFound, expectedActive),
    threadRecall: computeRecall(threadFound, expectedThreads),
  };
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
    id: "evt-default-branch",
    ts: "2026-03-12T00:00:00.500Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "agent_message",
    content: "Repository settings synced from origin.",
    metadata: {
      default_branch: "main",
    },
  });
  runtime.recordEvent({
    id: "evt-issue",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "issue_link",
    content: "Tracking issue #42: installer regression remains unresolved",
    metadata: { issue_id: "42" },
  });
  runtime.recordEvent({
    id: "evt-test",
    ts: "2026-03-12T00:00:02.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "test_result",
    content: "Hotfix branch still fails the Windows installer regression test.",
    scope: { branch: "fix/windows-install" },
    metadata: {
      exit_code: 1,
      failing_test: "Windows install path normalizer",
    },
  });
  runtime.recordEvent({
    id: "evt-backend-main",
    ts: "2026-03-12T00:00:03.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    scope: { branch: "main" },
    content: "Approved the persistence baseline.",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-backend-hotfix",
    ts: "2026-03-12T00:00:03.200Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    scope: { branch: "fix/windows-install" },
    content: "Approved the persistence baseline.",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-sequence-main",
    ts: "2026-03-12T00:00:03.400Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    scope: { branch: "main" },
    content: "Approved the install sequencing plan.",
    metadata: {
      memory_hints: {
        family_hint: "current_strategy",
        canonical_key_hint: "install.sequence",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-sequence-hotfix",
    ts: "2026-03-12T00:00:03.600Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    scope: { branch: "fix/windows-install" },
    content: "Approved the install sequencing plan.",
    metadata: {
      memory_hints: {
        family_hint: "current_strategy",
        canonical_key_hint: "install.sequence",
      },
    },
  });

  const packet = runtime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-session-recovery",
    scope: { branch: "fix/windows-install" },
  });

  const findClaim = (canonicalKey, expectedScope) => {
    const claim = runtime
      .listClaims("github.com/acme/demo")
      .find(
        (entry) =>
          entry.canonical_key === canonicalKey &&
          scopeSignature(entry.scope) === scopeSignature(expectedScope)
      );
    return requireValue(
      claim,
      `missing claim ${canonicalKey} @ ${scopeSignature(expectedScope)}`
    );
  };

  const activeExpected = [
    claimSignature(findClaim("repo.package_manager")),
    claimSignature(findClaim("repo.default_branch")),
    claimSignature(findClaim("decision.persistence.backend", { branch: "fix/windows-install" })),
    claimSignature(
      findClaim("decision.current_strategy.install.sequence", { branch: "fix/windows-install" })
    ),
  ];
  const threadExpected = [
    claimSignature(findClaim("thread.issue.42")),
    claimSignature(
      findClaim("thread.test.windows.install.path.normalizer", { branch: "fix/windows-install" })
    ),
    claimSignature(findClaim("thread.branch.fix.windows.install", { branch: "fix/windows-install" })),
  ];

  const activeRecall = computeRecall(packet.active_claims.map(claimSignature), activeExpected);
  const threadRecall = computeRecall(packet.open_threads.map(claimSignature), threadExpected);
  const noMemoryBaseline = runNoMemorySessionRecoveryBaseline(activeExpected, threadExpected);
  const keywordBaseline = runKeywordSessionRecoveryBaseline(runtime, activeExpected, threadExpected);
  const activeDeltaVsKeyword = activeRecall.recall - keywordBaseline.activeRecall.recall;
  const threadDeltaVsKeyword = threadRecall.recall - keywordBaseline.threadRecall.recall;
  const runtimeHardeningPass =
    activeRecall.recall >= 0.66 &&
    threadRecall.recall >= 0.8 &&
    (activeDeltaVsKeyword > 0 || threadDeltaVsKeyword > 0);
  const adapterReadinessPass =
    activeRecall.recall >= 0.66 &&
    threadRecall.recall >= 0.8 &&
    activeDeltaVsKeyword > 0;

  runtime.close();

  return {
    name: "session_recovery",
    pass: runtimeHardeningPass,
    adapter_readiness_pass: adapterReadinessPass,
    metrics: {
      active_claim_recall: round(activeRecall.recall),
      open_thread_recall: round(threadRecall.recall),
      active_claim_recall_delta_vs_no_memory: round(
        activeRecall.recall - noMemoryBaseline.activeRecall.recall
      ),
      open_thread_recall_delta_vs_no_memory: round(
        threadRecall.recall - noMemoryBaseline.threadRecall.recall
      ),
      active_claim_recall_delta_vs_keyword: round(
        activeDeltaVsKeyword
      ),
      open_thread_recall_delta_vs_keyword: round(
        threadDeltaVsKeyword
      ),
      active_claim_hits: activeRecall.hits,
      open_thread_hits: threadRecall.hits,
    },
    packet: {
      brief: packet.brief,
      active_claim_keys: canonicalKeys(packet.active_claims),
      active_claim_signatures: packet.active_claims.map(claimSignature),
      open_thread_keys: canonicalKeys(packet.open_threads),
      open_thread_signatures: packet.open_threads.map(claimSignature),
    },
  };
}

function runStaleSuppressionBenchmark() {
  const runtime = createRuntime("pmr-bench-stale-");

  runtime.recordEvent({
    id: "evt-stale-old",
    ts: "2025-01-01T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use JSON backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend.stale",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-active-current",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use SQLite backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend.active",
      },
    },
  });

  runtime.recordEvent({
    id: "evt-superseded-old",
    ts: "2026-03-10T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use flat-file backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend.superseded",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-superseded-new",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Replace flat-file backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend.superseded",
      },
    },
  });

  runtime.sweepStaleClaims("2026-03-13T00:00:00.000Z");

  const packet = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 1,
  });

  const activeKeys = canonicalKeys(packet.active_claims);
  const staleIndex = activeKeys.indexOf("decision.persistence.backend.stale");
  const activeIndex = activeKeys.indexOf("decision.persistence.backend.active");
  const supersededLeakage = packet.active_claims.some((claim) => claim.status === "superseded")
    ? 1
    : 0;
  const pass = supersededLeakage === 0 && activeIndex === 0 && staleIndex === -1;

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
  runtime.recordEvent({
    id: "evt-neutral",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use neutral backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.backend.neutral",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-negative",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use JSON backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.backend.negative",
      },
    },
  });
  runtime.recordEvent({
    id: "evt-positive",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use SQLite backend strategy",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.backend.positive",
      },
    },
  });

  const positiveClaim = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "decision.backend.positive");
  const negativeClaim = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "decision.backend.negative");
  const positiveClaimId = requireValue(positiveClaim?.id, "missing positive benchmark claim");
  const negativeClaimId = requireValue(negativeClaim?.id, "missing negative benchmark claim");

  const baseline = runtime.searchClaims({
    project_id: "github.com/acme/demo",
    query: "backend strategy",
    scope: {},
    limit: 10,
  });
  const baselineRanks = rankById(baseline);
  const rounds = [];

  for (let round = 1; round <= 3; round += 1) {
    runtime.recordEvent({
      id: `evt-positive-outcome-${round}`,
      ts: `2026-03-12T01:0${round}:00.000Z`,
      project_id: "github.com/acme/demo",
      agent_id: "claude-code",
      agent_version: "unknown",
      event_type: round % 2 === 0 ? "build_result" : "test_result",
      content: "Positive strategy succeeded",
      metadata: {
        exit_code: 0,
        related_claim_ids: [positiveClaimId],
      },
    });

    runtime.recordEvent({
      id: `evt-negative-outcome-${round}`,
      ts: `2026-03-12T01:1${round}:00.000Z`,
      project_id: "github.com/acme/demo",
      agent_id: "claude-code",
      agent_version: "unknown",
      event_type: "manual_override",
      capture_path: "operator.manual",
      content: "Negative strategy was overridden",
      metadata: {
        related_claim_ids: [negativeClaimId],
      },
    });

    const packet = runtime.searchClaims({
      project_id: "github.com/acme/demo",
      query: "backend strategy",
      scope: {},
      limit: 10,
    });
    const ranks = rankById(packet);
    rounds.push({
      round,
      positive_rank: ranks.get(positiveClaimId),
      negative_rank: ranks.get(negativeClaimId),
      order: canonicalKeys(packet.active_claims),
    });
  }

  const finalRound = rounds[rounds.length - 1];
  const allClaims = runtime.listClaims("github.com/acme/demo");
  const avoidanceClaimHistoryCount = allClaims.filter((claim) =>
    claim.canonical_key.startsWith("decision.avoid.")
  ).length;
  const avoidanceClaimGrowth = allClaims.filter(
    (claim) =>
      claim.canonical_key.startsWith("decision.avoid.") &&
      claim.status !== "superseded" &&
      claim.status !== "archived"
  ).length;
  const packetPollutionCount = (finalRound.order ?? []).filter((key) =>
    key.startsWith("decision.avoid.")
  ).length;
  const positiveDelta =
    requireValue(baselineRanks.get(positiveClaimId), "missing positive baseline rank") -
    requireValue(finalRound.positive_rank, "missing positive final rank");
  const negativeDelta =
    requireValue(finalRound.negative_rank, "missing negative final rank") -
    requireValue(baselineRanks.get(negativeClaimId), "missing negative baseline rank");
  const pass =
    rounds.length === 3 &&
    rounds[0].positive_rank >= finalRound.positive_rank &&
    rounds[0].negative_rank <= finalRound.negative_rank &&
    avoidanceClaimGrowth === 0 &&
    packetPollutionCount === 0 &&
    positiveDelta > 0 &&
    negativeDelta > 0;

  runtime.close();

  return {
    name: "outcome_learning",
    pass,
    metrics: {
      positive_rank_delta: positiveDelta,
      negative_rank_delta: negativeDelta,
      rounds: rounds.length,
      avoidance_claim_growth: avoidanceClaimGrowth,
      avoidance_claim_history_count: avoidanceClaimHistoryCount,
      packet_pollution_count: packetPollutionCount,
      final_positive_rank: finalRound.positive_rank,
      final_negative_rank: finalRound.negative_rank,
    },
    packet: {
      baseline_order: canonicalKeys(baseline.active_claims),
      rounds,
    },
  };
}

function runMultiAgentConsistencyBenchmark() {
  const { writer, reader } = createSharedRuntimePair("pmr-bench-multi-agent-");

  writer.recordEvent({
    id: "evt-facts",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "agent_message",
    content: "The repo uses pnpm and vitest. Run pnpm build.",
  });
  writer.recordEvent({
    id: "evt-issue",
    ts: "2026-03-12T00:00:01.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "issue_link",
    content: "Tracking issue #42",
    metadata: { issue_id: "42" },
  });
  writer.recordEvent({
    id: "evt-decision",
    ts: "2026-03-12T00:00:02.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use SQLite as the first persistence backend",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });

  const agentA = writer.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: {},
  });
  const agentB = reader.buildSessionBrief({
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

  const cloneWriter = createRuntime("pmr-bench-clone-writer-");
  const cloneReader = createRuntime("pmr-bench-clone-reader-");
  cloneWriter.recordEvent({
    id: "evt-clone-decision",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    workspace_id: "clone-a",
    repo_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use SQLite as the first persistence backend",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });
  const cloneEvents = cloneWriter.listEvents("github.com/acme/demo");
  for (const event of cloneEvents) {
    cloneReader.recordEvent({
      ...event,
      workspace_id: "clone-b",
      id: `${event.id}-clone-b`,
    });
  }
  const clonePacket = cloneReader.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "codex",
    scope: {},
  });
  const cloneConsistency =
    clonePacket.active_claims.some(
      (claim) => claim.canonical_key === "decision.persistence.backend"
    ) ? 1 : 0;

  const worktreeRuntime = createRuntime("pmr-bench-worktree-");
  worktreeRuntime.recordEvent({
    id: "evt-worktree-thread",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    workspace_id: "worktree-a",
    repo_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_message",
    capture_path: "fixture.user_message",
    scope: { branch: "fix/windows-install" },
    content: "Windows path normalization is blocking reliable install tests",
    metadata: {
      memory_hints: {
        family_hint: "blocker",
        canonical_key_hint: "windows.install",
      },
    },
  });
  const blockerClaim = worktreeRuntime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "thread.blocker.windows.install");
  if (blockerClaim) {
    worktreeRuntime.verifyClaim({
      claim_id: blockerClaim.id,
      status: "system_verified",
      method: "benchmark_review",
    });
  }
  const matchingWorktreePacket = worktreeRuntime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: { branch: "fix/windows-install" },
  });
  const otherWorktreePacket = worktreeRuntime.buildSessionBrief({
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    scope: { branch: "main" },
  });
  const worktreeIsolation =
    matchingWorktreePacket.open_threads.some(
      (claim) => claim.canonical_key === "thread.blocker.windows.install"
    ) &&
    !otherWorktreePacket.open_threads.some(
      (claim) => claim.canonical_key === "thread.blocker.windows.install"
    )
      ? 1
      : 0;

  const subprojectRuntime = createRuntime("pmr-bench-subproject-");
  subprojectRuntime.recordEvent({
    id: "evt-subproject-api",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/mono::packages/api",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use Fastify inside packages/api",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.subproject.framework",
      },
    },
  });
  subprojectRuntime.recordEvent({
    id: "evt-subproject-web",
    ts: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/mono::packages/web",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "fixture.user_confirmation",
    content: "Use Next.js inside packages/web",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.subproject.framework",
      },
    },
  });
  const apiPacket = subprojectRuntime.buildSessionBrief({
    project_id: "github.com/acme/mono::packages/api",
    agent_id: "claude-code",
    scope: {},
  });
  const webPacket = subprojectRuntime.buildSessionBrief({
    project_id: "github.com/acme/mono::packages/web",
    agent_id: "claude-code",
    scope: {},
  });
  const subprojectIsolation =
    apiPacket.active_claims.some((claim) => claim.content.includes("Fastify")) &&
    !apiPacket.active_claims.some((claim) => claim.content.includes("Next.js")) &&
    webPacket.active_claims.some((claim) => claim.content.includes("Next.js")) &&
    !webPacket.active_claims.some((claim) => claim.content.includes("Fastify"))
      ? 1
      : 0;

  writer.close();
  reader.close();
  cloneWriter.close();
  cloneReader.close();
  worktreeRuntime.close();
  subprojectRuntime.close();

  return {
    name: "multi_agent_consistency",
    pass: pass && cloneConsistency === 1 && worktreeIsolation === 1 && subprojectIsolation === 1,
    metrics: {
      active_decision_mismatch: JSON.stringify(activeA) === JSON.stringify(activeB) ? 0 : 1,
      open_thread_divergence: JSON.stringify(threadsA) === JSON.stringify(threadsB) ? 0 : 1,
      clone_consistency: cloneConsistency,
      worktree_isolation: worktreeIsolation,
      subproject_isolation: subprojectIsolation,
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
    `Runtime hardening: ${results.overall_pass ? "PASS" : "FAIL"}`,
    `Adapter readiness: ${results.adapter_readiness_pass ? "PASS" : "FAIL"}`,
    "",
  ];

  for (const suite of results.suites) {
    lines.push(`## ${suite.name}`);
    lines.push("");
    lines.push(`Runtime hardening status: ${suite.pass ? "PASS" : "FAIL"}`);
    if (suite.adapter_readiness_pass !== undefined) {
      lines.push(
        `Adapter readiness status: ${suite.adapter_readiness_pass ? "PASS" : "FAIL"}`
      );
    }
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
  adapter_readiness_pass: suites.every(
    (suite) => (suite.adapter_readiness_pass ?? suite.pass)
  ),
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
  adapter_readiness_pass: results.adapter_readiness_pass,
  json: jsonPath,
  markdown: markdownPath,
}, null, 2));
