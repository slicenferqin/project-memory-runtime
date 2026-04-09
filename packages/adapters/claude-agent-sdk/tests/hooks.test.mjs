import { mkdtempSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function runGit(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function createSdkBridge() {
  return import("../dist/index.js");
}

async function createClaudeAdapter() {
  return import("@slicenfer/project-memory-adapter-claude-code");
}

function getHookCallback(hooks, eventName) {
  return hooks[eventName][0].hooks[0];
}

test("SessionStart returns session brief and checkpoint additionalContext via SDK hooks", async () => {
  const sdkBridge = await createSdkBridge();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-sdk-sessionstart-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const hooks = sdkBridge.createProjectMemoryHooks({ dataDir: path.join(tempRoot, "data") });
  const postToolUseFailure = getHookCallback(hooks, "PostToolUseFailure");
  const stopFailure = getHookCallback(hooks, "StopFailure");
  const sessionStart = getHookCallback(hooks, "SessionStart");

  await postToolUseFailure({
    hook_event_name: "PostToolUseFailure",
    session_id: "sdk-session-1",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: repoPath,
      branch: "main",
    },
    tool_use_id: "tool-1",
    error: "Command exited with non-zero status code 1. Test failed: sdk bridge regression",
  });

  await stopFailure({
    hook_event_name: "StopFailure",
    session_id: "sdk-session-1",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    error: "server_error",
    error_details: "partial response dropped",
    last_assistant_message: "I was debugging the sdk bridge regression",
  });

  const output = await sessionStart({
    hook_event_name: "SessionStart",
    session_id: "sdk-session-2",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    source: "startup",
    model: "claude-sonnet-4-6",
  });

  assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(output.hookSpecificOutput.additionalContext, /Project Memory/);
  assert.match(output.hookSpecificOutput.additionalContext, /Continuation checkpoint/);
  assert.match(output.hookSpecificOutput.additionalContext, /sdk bridge regression/);
});

test("UserPromptSubmit and PreToolUse inject scoped recall context", async () => {
  const sdkBridge = await createSdkBridge();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-sdk-additional-context-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const hooks = sdkBridge.createProjectMemoryHooks({ dataDir: path.join(tempRoot, "data") });
  const postToolUseFailure = getHookCallback(hooks, "PostToolUseFailure");
  const userPromptSubmit = getHookCallback(hooks, "UserPromptSubmit");
  const preToolUse = getHookCallback(hooks, "PreToolUse");

  await postToolUseFailure({
    hook_event_name: "PostToolUseFailure",
    session_id: "sdk-query-1",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test auth",
      cwd: repoPath,
      branch: "main",
    },
    tool_use_id: "tool-2",
    error: "Command exited with non-zero status code 1. Test failed: auth retry budget",
  });

  const promptOutput = await userPromptSubmit({
    hook_event_name: "UserPromptSubmit",
    session_id: "sdk-query-1",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    prompt: "why is the auth retry budget test failing?",
  });
  assert.equal(promptOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(promptOutput.hookSpecificOutput.additionalContext, /auth retry budget/);

  const toolOutput = await preToolUse({
    hook_event_name: "PreToolUse",
    session_id: "sdk-query-1",
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    cwd: repoPath,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: { command: "pnpm test auth" },
    tool_use_id: "tool-3",
  });
  assert.equal(toolOutput.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(toolOutput.hookSpecificOutput.additionalContext, /auth retry budget/);
});

test("non-git directories are a no-op", async () => {
  const sdkBridge = await createSdkBridge();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-sdk-no-git-"));

  const output = sdkBridge.executeProjectMemorySdkHook({
    hook_event_name: "SessionStart",
    session_id: "sdk-no-git",
    transcript_path: path.join(tempRoot, "transcript.jsonl"),
    cwd: tempRoot,
    permission_mode: "acceptEdits",
    source: "startup",
    model: "claude-sonnet-4-6",
  });

  assert.deepEqual(output, {});
  assert.equal(fs.existsSync(path.join(tempRoot, ".memory", "runtime.sqlite")), false);
});

test("routing honors global config, legacy local db, and repo override", async () => {
  const sdkBridge = await createSdkBridge();
  const claudeAdapter = await createClaudeAdapter();

  const claudeHome = mkdtempSync(path.join(os.tmpdir(), "pmr-sdk-claude-home-"));
  process.env.PMR_CLAUDE_HOME = claudeHome;
  const globalConfig = claudeAdapter.defaultGlobalInstallConfig();
  claudeAdapter.writeGlobalInstallConfig(globalConfig);

  const newRepo = path.join(claudeHome, "new-repo");
  fs.mkdirSync(newRepo, { recursive: true });
  runGit(newRepo, ["init", "-b", "main"]);
  runGit(newRepo, ["remote", "add", "origin", "https://github.com/acme/new-repo.git"]);

  sdkBridge.executeProjectMemorySdkHook({
    hook_event_name: "PostToolUseFailure",
    session_id: "global-route",
    transcript_path: path.join(newRepo, ".claude", "transcript.jsonl"),
    cwd: newRepo,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", cwd: newRepo },
    tool_use_id: "tool-global",
    error: "Command exited with non-zero status code 1. Test failed: global route",
  });
  assert.equal(fs.existsSync(globalConfig.db_path), true);

  const legacyRepo = path.join(claudeHome, "legacy-repo");
  fs.mkdirSync(legacyRepo, { recursive: true });
  runGit(legacyRepo, ["init", "-b", "main"]);
  runGit(legacyRepo, ["remote", "add", "origin", "https://github.com/acme/legacy-repo.git"]);
  const legacyDataDir = path.join(legacyRepo, ".memory");
  const legacyRuntime = claudeAdapter.createClaudeCodeRuntime({ dataDir: legacyDataDir });
  legacyRuntime.close();

  sdkBridge.executeProjectMemorySdkHook({
    hook_event_name: "PostToolUseFailure",
    session_id: "legacy-route",
    transcript_path: path.join(legacyRepo, ".claude", "transcript.jsonl"),
    cwd: legacyRepo,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", cwd: legacyRepo },
    tool_use_id: "tool-legacy",
    error: "Command exited with non-zero status code 1. Test failed: legacy route",
  });

  const localRuntime = claudeAdapter.createClaudeCodeRuntime({ dataDir: legacyDataDir });
  const globalRuntime = claudeAdapter.createClaudeCodeRuntime({ dataDir: globalConfig.data_dir });
  assert.ok(localRuntime.listEvents("github.com/acme/legacy-repo").length > 0);
  assert.equal(globalRuntime.listEvents("github.com/acme/legacy-repo").length, 0);
  localRuntime.close();
  globalRuntime.close();

  const disabledRepo = path.join(claudeHome, "disabled-repo");
  fs.mkdirSync(path.join(disabledRepo, ".claude"), { recursive: true });
  runGit(disabledRepo, ["init", "-b", "main"]);
  runGit(disabledRepo, ["remote", "add", "origin", "https://github.com/acme/disabled-repo.git"]);
  fs.writeFileSync(
    path.join(disabledRepo, ".claude", "project-memory.json"),
    `${JSON.stringify({ mode: "disabled" }, null, 2)}\n`
  );

  const disabledOutput = sdkBridge.executeProjectMemorySdkHook({
    hook_event_name: "SessionStart",
    session_id: "disabled-route",
    transcript_path: path.join(disabledRepo, ".claude", "transcript.jsonl"),
    cwd: disabledRepo,
    permission_mode: "acceptEdits",
    source: "startup",
    model: "claude-sonnet-4-6",
  });
  assert.deepEqual(disabledOutput, {});

  const localOverrideRepo = path.join(claudeHome, "local-override-repo");
  const localOverrideDataDir = path.join(localOverrideRepo, ".pmr-local");
  fs.mkdirSync(path.join(localOverrideRepo, ".claude"), { recursive: true });
  runGit(localOverrideRepo, ["init", "-b", "main"]);
  runGit(localOverrideRepo, ["remote", "add", "origin", "https://github.com/acme/local-override-repo.git"]);
  fs.writeFileSync(
    path.join(localOverrideRepo, ".claude", "project-memory.json"),
    `${JSON.stringify({ mode: "local", data_dir: ".pmr-local" }, null, 2)}\n`
  );

  sdkBridge.executeProjectMemorySdkHook({
    hook_event_name: "PostToolUseFailure",
    session_id: "local-override-route",
    transcript_path: path.join(localOverrideRepo, ".claude", "transcript.jsonl"),
    cwd: localOverrideRepo,
    permission_mode: "acceptEdits",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", cwd: localOverrideRepo },
    tool_use_id: "tool-local-override",
    error: "Command exited with non-zero status code 1. Test failed: local override route",
  });

  assert.equal(fs.existsSync(path.join(localOverrideDataDir, "runtime.sqlite")), true);

  delete process.env.PMR_CLAUDE_HOME;
});

test("withProjectMemory preserves user options and appends PMR hooks", async () => {
  const sdkBridge = await createSdkBridge();
  const existingHook = async () => ({ systemMessage: "existing" });
  const canUseTool = async () => ({ behavior: "allow" });
  const options = sdkBridge.withProjectMemory(
    {
      cwd: "/repo",
      settingSources: ["project"],
      plugins: [{ type: "local", path: "./plugin" }],
      canUseTool,
      permissionMode: "acceptEdits",
      hooks: {
        SessionStart: [{ hooks: [existingHook] }],
      },
    },
    {
      agent_id: "my-app",
    }
  );

  assert.deepEqual(options.settingSources, ["project"]);
  assert.deepEqual(options.plugins, [{ type: "local", path: "./plugin" }]);
  assert.equal(options.canUseTool, canUseTool);
  assert.equal(options.permissionMode, "acceptEdits");
  assert.equal(options.hooks.SessionStart.length, 2);
  assert.equal(options.hooks.SessionStart[0].hooks[0], existingHook);
  assert.ok(options.hooks.PostToolUse.length > 0);
});
