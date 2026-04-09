import { mkdtempSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runGit(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function invokeCli(workdir, envelope, dataDir) {
  return spawnSync(
    process.execPath,
    [CLI_PATH, "--data-dir", dataDir],
    {
      cwd: workdir,
      input: JSON.stringify(envelope),
      encoding: "utf8",
    }
  );
}

const PARSE_OPTIONS = {
  project_id: "github.com/acme/demo",
  repo_id: "github.com/acme/demo",
  workspace_id: "ws-test",
};

// ─── parseClaudeHookEnvelope unit tests ────────────────────────────────

test("parseClaudeHookEnvelope: UserPromptSubmit records user_message and enables additionalContext", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      cwd: "/repo",
      prompt: "How do I run the tests?",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, true);
  assert.equal(parsed.additionalContextQuery, "How do I run the tests?");
  assert.ok(parsed.input);
  assert.equal(parsed.input.kind, "user_message");
  assert.equal(parsed.input.content, "How do I run the tests?");
});

test("parseClaudeHookEnvelope: PostCompact records session_end with compact_summary", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "PostCompact",
      session_id: "s1",
      cwd: "/repo",
      trigger: "auto",
      compact_summary: "Implemented auth module and fixed 3 test failures",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, false);
  assert.ok(parsed.input);
  assert.equal(parsed.input.hook, "SessionEnd");
  assert.equal(parsed.input.note, "Implemented auth module and fixed 3 test failures");
  assert.equal(parsed.input.metadata?.trigger, "auto");
  assert.equal(parsed.input.metadata?.compact_summary, "Implemented auth module and fixed 3 test failures");
  assert.equal(parsed.input.metadata?.source, "post_compact");
});

test("parseClaudeHookEnvelope: StopFailure records session_end with error metadata", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "StopFailure",
      session_id: "s1",
      cwd: "/repo",
      error: "API connection timeout",
      error_details: "Request timed out after 30s",
      last_assistant_message: "I was in the middle of refactoring the auth module",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, false);
  assert.ok(parsed.input);
  assert.equal(parsed.input.hook, "SessionEnd");
  assert.match(parsed.input.note, /partial response preserved/);
  assert.match(parsed.input.note, /refactoring the auth module/);
  assert.equal(parsed.input.metadata?.is_error, true);
  assert.equal(parsed.input.metadata?.source, "stop_failure");
});

test("parseClaudeHookEnvelope: SubagentStop records Stop with subagent metadata", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "SubagentStop",
      session_id: "s1",
      cwd: "/repo",
      agent_id: "agent-123",
      agent_type: "general-purpose",
      agent_transcript_path: "/tmp/transcript.jsonl",
      last_assistant_message: "Found and fixed the performance regression",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, false);
  assert.ok(parsed.input);
  assert.equal(parsed.input.hook, "Stop");
  assert.equal(parsed.input.note, "Found and fixed the performance regression");
  assert.equal(parsed.input.metadata?.subagent_id, "agent-123");
  assert.equal(parsed.input.metadata?.subagent_type, "general-purpose");
  assert.equal(parsed.input.metadata?.source, "subagent_stop");
});

test("parseClaudeHookEnvelope: PreToolUse is query-only with null input", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_use_id: "tu-1",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, true);
  assert.equal(parsed.additionalContextQuery, "pnpm test");
  assert.equal(parsed.input, null);
});

test("parseClaudeHookEnvelope: Setup maintenance sets maintenanceSweep flag", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "Setup",
      session_id: "s1",
      cwd: "/repo",
      trigger: "maintenance",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.shouldInjectSessionBrief, false);
  assert.equal(parsed.shouldInjectAdditionalContext, false);
  assert.equal(parsed.maintenanceSweep, true);
  assert.ok(parsed.input);
  assert.equal(parsed.input.hook, "SessionStart");
  assert.match(parsed.input.note, /maintenance/);
  assert.equal(parsed.input.metadata?.trigger, "maintenance");
  assert.equal(parsed.input.metadata?.source, "setup");
});

test("parseClaudeHookEnvelope: Setup init does not set maintenanceSweep", async () => {
  const mod = await import("../dist/hook-envelope.js");
  const parsed = mod.parseClaudeHookEnvelope(
    {
      hook_event_name: "Setup",
      session_id: "s1",
      cwd: "/repo",
      trigger: "init",
      model: "claude-sonnet-4.6",
    },
    PARSE_OPTIONS
  );

  assert.equal(parsed.maintenanceSweep, false);
});

// ─── adapter integration tests ─────────────────────────────────────────

test("adapter.record(null) returns empty array for query-only hooks", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-null-input-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-pretool",
      repo_id: "github.com/acme/demo",
    },
  });

  const events = adapter.record(null);
  assert.deepEqual(events, []);
  assert.equal(runtime.listEvents("github.com/acme/demo").length, 0);

  runtime.close();
});

test("adapter.injectAdditionalContext returns null for empty query", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-addctx-empty-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-addctx",
      repo_id: "github.com/acme/demo",
    },
  });

  const result = adapter.injectAdditionalContext("");
  assert.equal(result, null);

  runtime.close();
});

test("adapter.injectAdditionalContext returns relevant claims when available", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-addctx-match-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-addctx-match",
      repo_id: "github.com/acme/demo",
      branch: "main",
      cwd: "/repo",
    },
  });

  // Record a test failure to create a thread claim
  adapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", cwd: "/repo", branch: "main" },
    tool_output: {
      stdout: "auth module integration test failed",
      failing_test: "auth module integration",
    },
    exit_code: 1,
  });

  const result = adapter.injectAdditionalContext("test");
  assert.ok(result !== null, "should return context when claims exist");
  assert.match(result, /auth module integration/);

  runtime.close();
});

// ─── executeClaudeHookEnvelope integration tests ────────────────────────

test("executeClaudeHookEnvelope: UserPromptSubmit records event and returns additionalContext", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-user-prompt-"));
  const mod = await import("../dist/hook-envelope.js");
  const adapterModule = await import("../dist/index.js");

  // Seed a claim first so additionalContext has something to return
  const seedRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const seedAdapter = new adapterModule.ClaudeCodeAdapter({
    runtime: seedRuntime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "seed-session",
      repo_id: "github.com/acme/demo",
      cwd: tempDir,
    },
  });
  seedAdapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_output: {
      stdout: "Windows install path normalizer failed",
      failing_test: "Windows install path normalizer",
    },
    exit_code: 1,
  });
  seedRuntime.close();

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-user-prompt",
      cwd: tempDir,
      prompt: "How do I fix the Windows test?",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.ok(result.events.length > 0, "should record user_message event");
  assert.equal(result.events[0]?.event_type, "user_message");
  assert.ok(result.additionalContext, "should return additional context");
  assert.match(result.additionalContext, /Windows install path normalizer/);
  assert.equal(result.injection, undefined);
});

test("executeClaudeHookEnvelope: PostCompact records session_end event", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-post-compact-"));
  const mod = await import("../dist/hook-envelope.js");

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "PostCompact",
      session_id: "session-compact",
      cwd: "/repo",
      trigger: "auto",
      compact_summary: "Implemented auth module with JWT tokens",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.ok(result.events.length > 0, "should record session_end event");
  assert.equal(result.events[0]?.event_type, "session_end");
  assert.equal(result.additionalContext, undefined);
  assert.equal(result.staleClaimed, undefined);
});

test("executeClaudeHookEnvelope: StopFailure records session_end with error", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-stop-failure-"));
  const mod = await import("../dist/hook-envelope.js");

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "StopFailure",
      session_id: "session-stop-fail",
      cwd: "/repo",
      error_details: "API rate limit exceeded",
      last_assistant_message: "Updating the database schema",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.ok(result.events.length > 0, "should record session_end event");
  assert.equal(result.events[0]?.event_type, "session_end");
  assert.equal(result.additionalContext, undefined);
});

test("executeClaudeHookEnvelope: SubagentStop records session_end event", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-subagent-"));
  const mod = await import("../dist/hook-envelope.js");

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "SubagentStop",
      session_id: "session-subagent",
      cwd: "/repo",
      agent_id: "agent-42",
      agent_type: "general-purpose",
      last_assistant_message: "Completed code review analysis",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.ok(result.events.length > 0, "should record session_end event");
  assert.equal(result.events[0]?.event_type, "session_end");
  assert.equal(result.additionalContext, undefined);
});

test("executeClaudeHookEnvelope: PreToolUse records no events, only queries", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-pretool-"));
  const mod = await import("../dist/hook-envelope.js");

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "PreToolUse",
      session_id: "session-pretool",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "pnpm build" },
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.deepEqual(result.events, [], "should record no events");
  assert.equal(result.injection, undefined);
  // additionalContext may be null (no claims to match), that's fine
});

test("executeClaudeHookEnvelope: Setup maintenance runs sweepStaleClaims", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-setup-maint-"));
  const mod = await import("../dist/hook-envelope.js");

  const result = mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "Setup",
      session_id: "session-setup",
      cwd: "/repo",
      trigger: "maintenance",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  assert.ok(result.events.length > 0, "should record session_start event");
  assert.equal(result.events[0]?.event_type, "session_start");
  assert.equal(typeof result.staleClaimed, "number", "should return stale claim count");
});

test("executeClaudeHookEnvelope records checkpoints for PreCompact and SessionEnd", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-checkpoints-lifecycle-"));
  const worktreeDir = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(worktreeDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, "src", "auth.ts"), "export const authMode = 'sqlite';\n");

  const mod = await import("../dist/hook-envelope.js");
  const adapterModule = await import("../dist/index.js");

  const seedRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  seedRuntime.getAdminApi().insertClaimRecord({
    id: "clm-thread-checkpoint",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.issue.42",
    cardinality: "singleton",
    content: "Refactor auth module",
    source_event_ids: ["evt-thread-checkpoint"],
    confidence: 0.9,
    importance: 0.9,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
    thread_status: "open",
    scope: {
      branch: "main",
      cwd_prefix: worktreeDir,
      files: [path.join(worktreeDir, "src", "auth.ts")],
    },
  });
  seedRuntime.close();

  mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "PreCompact",
      session_id: "s-checkpoint-1",
      cwd: worktreeDir,
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "SessionEnd",
      session_id: "s-checkpoint-1",
      cwd: worktreeDir,
      reason: "Finished auth cleanup",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  const verifyRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const checkpoints = verifyRuntime.listSessionCheckpoints("github.com/acme/demo");
  assert.ok(checkpoints.some((checkpoint) => checkpoint.source === "precompact"));
  assert.ok(checkpoints.some((checkpoint) => checkpoint.source === "session_end"));
  verifyRuntime.close();
});

test("executeClaudeHookEnvelope records checkpoints for PostCompact and StopFailure", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-checkpoints-errors-"));
  const worktreeDir = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(worktreeDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, "src", "auth.ts"), "export const authMode = 'sqlite';\n");

  const mod = await import("../dist/hook-envelope.js");
  const adapterModule = await import("../dist/index.js");

  const seedRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  seedRuntime.getAdminApi().insertClaimRecord({
    id: "clm-thread-checkpoint-2",
    created_at: "2026-03-12T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    type: "thread",
    assertion_kind: "todo",
    canonical_key: "thread.issue.43",
    cardinality: "singleton",
    content: "Fix compacted auth flow",
    source_event_ids: ["evt-thread-checkpoint-2"],
    confidence: 0.9,
    importance: 0.9,
    outcome_score: 0,
    verification_status: "user_confirmed",
    status: "active",
    thread_status: "open",
    scope: {
      branch: "main",
      cwd_prefix: worktreeDir,
      files: [path.join(worktreeDir, "src", "auth.ts")],
    },
  });
  seedRuntime.close();

  mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "PostCompact",
      session_id: "s-checkpoint-2",
      cwd: worktreeDir,
      compact_summary: "Compacted around auth work",
      trigger: "manual",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  mod.executeClaudeHookEnvelope(
    {
      hook_event_name: "StopFailure",
      session_id: "s-checkpoint-2",
      cwd: worktreeDir,
      error: "API timeout",
      error_details: "Timed out during auth refactor",
      last_assistant_message: "Refactoring auth module",
      model: "claude-sonnet-4.6",
    },
    { dataDir: tempDir, ...PARSE_OPTIONS }
  );

  const verifyRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const checkpoints = verifyRuntime.listSessionCheckpoints("github.com/acme/demo");
  assert.ok(checkpoints.some((checkpoint) => checkpoint.source === "postcompact"));
  assert.ok(checkpoints.some((checkpoint) => checkpoint.source === "stop_failure"));
  verifyRuntime.close();
});

test("executeClaudeHookEnvelope no-ops in global mode outside git repositories", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-global-nongit-"));
  const claudeHome = path.join(tempDir, "claude-home");
  const nonGitDir = path.join(tempDir, "scratch");
  fs.mkdirSync(nonGitDir, { recursive: true });

  const previousClaudeHome = process.env.PMR_CLAUDE_HOME;
  process.env.PMR_CLAUDE_HOME = claudeHome;

  try {
    const mod = await import("../dist/hook-envelope.js");
    const adapterModule = await import("../dist/index.js");
    adapterModule.writeGlobalInstallConfig(adapterModule.defaultGlobalInstallConfig());

    const result = mod.executeClaudeHookEnvelope(
      {
        hook_event_name: "SessionStart",
        session_id: "session-nongit",
        cwd: nonGitDir,
        model: "claude-sonnet-4.6",
      },
      {}
    );

    assert.deepEqual(result.events, []);
    assert.equal(result.injection, undefined);
    assert.equal(result.additionalContext, undefined);
  } finally {
    if (previousClaudeHome === undefined) {
      delete process.env.PMR_CLAUDE_HOME;
    } else {
      process.env.PMR_CLAUDE_HOME = previousClaudeHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeClaudeHookEnvelope routes new git repos to shared global storage", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-exec-global-shared-"));
  const claudeHome = path.join(tempDir, "claude-home");
  const repoPath = path.join(tempDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const previousClaudeHome = process.env.PMR_CLAUDE_HOME;
  process.env.PMR_CLAUDE_HOME = claudeHome;

  try {
    const mod = await import("../dist/hook-envelope.js");
    const adapterModule = await import("../dist/index.js");
    const config = adapterModule.defaultGlobalInstallConfig();
    adapterModule.writeGlobalInstallConfig(config);

    const result = mod.executeClaudeHookEnvelope(
      {
        hook_event_name: "PostToolUseFailure",
        session_id: "session-global-shared",
        cwd: repoPath,
        tool_name: "Bash",
        tool_input: { command: "pnpm test", cwd: repoPath },
        error: "Test failed: database migration test",
        model: "claude-sonnet-4.6",
      },
      {}
    );

    assert.equal(result.events.length, 1);
    assert.ok(fs.existsSync(config.db_path), "shared global runtime DB should be created");
    assert.ok(!fs.existsSync(path.join(repoPath, ".memory", "runtime.sqlite")), "repo-local runtime DB should not be created");

    const runtime = adapterModule.createClaudeCodeRuntime({
      dataDir: config.data_dir,
      dbPath: config.db_path,
    });
    const claims = runtime.listClaims("github.com/acme/demo");
    assert.ok(claims.some((claim) => claim.canonical_key === "thread.test.database.migration.test"));
    runtime.close();
  } finally {
    if (previousClaudeHome === undefined) {
      delete process.env.PMR_CLAUDE_HOME;
    } else {
      process.env.PMR_CLAUDE_HOME = previousClaudeHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── CLI E2E tests for new hooks ────────────────────────────────────────

test("CLI: UserPromptSubmit returns additionalContext when claims exist", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-user-prompt-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  // Seed: record a test failure first
  const seedResult = invokeCli(repoPath, {
    hook_event_name: "PostToolUseFailure",
    session_id: "session-prompt-cli",
    cwd: repoPath,
    tool_name: "Bash",
    tool_input: { command: "pnpm test", cwd: repoPath },
    error: "Test failed: database migration test",
    model: "claude-sonnet-4.6",
  }, dataDir);
  assert.equal(seedResult.status, 0);

  // Now send UserPromptSubmit
  const promptResult = invokeCli(repoPath, {
    hook_event_name: "UserPromptSubmit",
    session_id: "session-prompt-cli",
    cwd: repoPath,
    prompt: "How do I fix the database migration test?",
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(promptResult.status, 0);
  if (promptResult.stdout.trim()) {
    const output = JSON.parse(promptResult.stdout.trim());
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.ok(output.hookSpecificOutput.additionalContext);
  }
});

test("CLI: PreToolUse does not record events", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-pretool-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const result = invokeCli(repoPath, {
    hook_event_name: "PreToolUse",
    session_id: "session-pretool-cli",
    cwd: repoPath,
    tool_name: "Bash",
    tool_input: { command: "pnpm build" },
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(result.status, 0);
  // PreToolUse with no seeded claims should produce no output
});

test("CLI: PostCompact records event without stdout", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-postcompact-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const result = invokeCli(repoPath, {
    hook_event_name: "PostCompact",
    session_id: "session-compact-cli",
    cwd: repoPath,
    trigger: "auto",
    compact_summary: "Worked on implementing auth and refactoring tests",
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "", "PostCompact should produce no stdout");
});

test("CLI: Setup maintenance exits cleanly", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-setup-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const result = invokeCli(repoPath, {
    hook_event_name: "Setup",
    session_id: "session-setup-cli",
    cwd: repoPath,
    trigger: "maintenance",
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(result.status, 0);
});

test("CLI: StopFailure records event without stdout", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-stopfailure-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const result = invokeCli(repoPath, {
    hook_event_name: "StopFailure",
    session_id: "session-stopfail-cli",
    cwd: repoPath,
    error_details: "API overload",
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "", "StopFailure should produce no stdout");
});

test("CLI: SubagentStop records event without stdout", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-cli-subagent-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const result = invokeCli(repoPath, {
    hook_event_name: "SubagentStop",
    session_id: "session-subagent-cli",
    cwd: repoPath,
    agent_id: "agent-99",
    agent_type: "general-purpose",
    last_assistant_message: "Finished analyzing codebase",
    model: "claude-sonnet-4.6",
  }, dataDir);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "", "SubagentStop should produce no stdout");
});
