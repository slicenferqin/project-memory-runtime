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

test("claude adapter records hook and message events through runtime-first capture paths", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-adapter-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-1",
      repo_id: "github.com/acme/demo",
      branch: "fix/windows-install",
    },
  });

  adapter.record({
    kind: "user_confirmation",
    content: "Use SQLite as the first persistence backend",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });

  adapter.record({
    kind: "user_message",
    content: "Windows path normalization is blocking reliable install tests",
    metadata: {
      memory_hints: {
        family_hint: "blocker",
        canonical_key_hint: "windows.install",
      },
    },
  });

  adapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: "/repo",
      branch: "fix/windows-install",
    },
    tool_output: {
      stdout: "Windows install path normalizer failed",
      failing_test: "Windows install path normalizer",
    },
    exit_code: 1,
  });

  const claims = runtime.listClaims("github.com/acme/demo");
  const events = runtime.listEvents("github.com/acme/demo");

  assert.ok(
    events.some((event) => event.capture_path === "import.transcript")
  );
  assert.ok(
    events.some(
      (event) =>
        event.capture_path === "import.transcript" && event.event_type === "user_message"
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.capture_path === "system.tool_observation" && event.event_type === "test_result"
    )
  );
  assert.ok(
    !claims.some((claim) => claim.canonical_key === "decision.persistence.backend")
  );
  assert.ok(
    claims.some((claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer")
  );
  assert.ok(
    !claims.some((claim) => claim.canonical_key === "thread.blocker.windows.install")
  );

  runtime.close();
});

test("claude adapter keeps trusted message scope bound to the current session context", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-scope-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-branch-main",
      repo_id: "github.com/acme/demo",
      branch: "main",
      cwd: "/repo",
    },
  });

  adapter.record({
    kind: "user_confirmation",
    content: "Use SQLite as the first persistence backend",
    scope: {
      branch: "fix/windows-install",
      cwd: "/repo/hotfix",
      files: ["packages/windows/install.ts"],
    },
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });

  const events = runtime.listEvents("github.com/acme/demo");
  const decision = runtime
    .listClaims("github.com/acme/demo")
    .find((claim) => claim.canonical_key === "decision.persistence.backend");

  assert.equal(events[0]?.scope?.branch, "main");
  assert.equal(events[0]?.scope?.cwd, "/repo");
  assert.deepEqual(events[0]?.scope?.files, ["/repo/packages/windows/install.ts"]);
  assert.equal(events[0]?.capture_path, "import.transcript");
  assert.equal(decision, undefined);
  assert.ok(
    !runtime
      .listClaims("github.com/acme/demo")
      .some((claim) => claim.canonical_key === "thread.branch.fix.windows.install")
  );

  runtime.close();
});

test("claude adapter drops trusted file scope entries outside the workspace root", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-files-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-files",
      repo_id: "github.com/acme/demo",
      branch: "main",
      cwd: "/repo",
    },
  });

  adapter.record({
    kind: "user_confirmation",
    content: "This transcript line should stay untrusted",
    scope: {
      files: ["/outside/repo/secret.ts", "src/in-repo.ts"],
    },
  });

  const events = runtime.listEvents("github.com/acme/demo");
  assert.deepEqual(events[0]?.scope?.files, ["/repo/src/in-repo.ts"]);
  assert.equal(events[0]?.capture_path, "import.transcript");

  runtime.close();
});

test("claude adapter injects session brief once per unchanged packet", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-brief-"));
  const adapterModule = await import("../dist/index.js");

  const context = {
    project_id: "github.com/acme/demo",
    workspace_id: "ws-1",
    session_id: "session-2",
    repo_id: "github.com/acme/demo",
    branch: "main",
    cwd: "/repo",
  };

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context,
  });

  adapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: "/repo",
      branch: "main",
    },
    tool_output: {
      stdout: "Windows install path normalizer failed",
      failing_test: "Windows install path normalizer",
    },
    exit_code: 1,
  });

  const first = adapter.injectSessionBrief();
  runtime.close();

  const secondRuntime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const secondAdapter = new adapterModule.ClaudeCodeAdapter({
    runtime: secondRuntime,
    context: {
      ...context,
    },
  });
  const second = secondAdapter.injectSessionBrief();

  assert.equal(first.deduped, false);
  assert.ok(first.text?.includes("Project Memory"));
  assert.ok(
    first.packet.open_threads.some(
      (claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer"
    )
  );
  assert.ok(first.text?.includes("Windows install path normalizer"));
  assert.equal(second.deduped, true);
  assert.equal(second.text, null);

  secondRuntime.close();
});

test("claude adapter helper keeps trusted hook capture paths opt-in", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-hook-gate-"));
  const optInTempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-hook-optin-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  assert.throws(() =>
    runtime.recordEvent({
      id: "evt-trusted-hook-default",
      ts: "2026-03-15T00:00:00.000Z",
      project_id: "github.com/acme/demo",
      agent_id: "claude-code",
      agent_version: "unknown",
      event_type: "user_confirmation",
      capture_path: "claude_code.hook.user_confirmation",
      content: "Use SQLite as the first persistence backend",
      metadata: {
        memory_hints: {
          canonical_key_hint: "decision.persistence.backend",
        },
      },
    })
  );
  runtime.close();

  assert.throws(() =>
    adapterModule.createClaudeCodeRuntime({
      dataDir: tempDir,
      allowed_capture_paths: ["claude_code.hook.user_confirmation"],
    })
  );

  const optInRuntime = adapterModule.createClaudeCodeRuntime({
    dataDir: optInTempDir,
    enable_claude_hook_capture_paths: true,
  });
  optInRuntime.recordEvent({
    id: "evt-trusted-hook-optin",
    ts: "2026-03-15T00:00:00.000Z",
    project_id: "github.com/acme/demo",
    agent_id: "claude-code",
    agent_version: "unknown",
    event_type: "user_confirmation",
    capture_path: "claude_code.hook.user_confirmation",
    content: "Use SQLite as the first persistence backend",
    metadata: {
      memory_hints: {
        canonical_key_hint: "decision.persistence.backend",
      },
    },
  });
  assert.ok(
    optInRuntime
      .listClaims("github.com/acme/demo")
      .some((claim) => claim.canonical_key === "decision.persistence.backend")
  );
  optInRuntime.close();
});

test("defaultClaudeProjectId uses canonical remote identity across local clones", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-project-id-"));
  const repoA = path.join(tempRoot, "repo-a");
  const repoB = path.join(tempRoot, "repo-b");
  fs.mkdirSync(repoA, { recursive: true });
  fs.mkdirSync(repoB, { recursive: true });
  const adapterModule = await import("../dist/index.js");

  runGit(repoA, ["init"]);
  runGit(repoA, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);
  runGit(repoB, ["init"]);
  runGit(repoB, ["remote", "add", "origin", "git@github.com:acme/demo.git"]);

  assert.equal(
    adapterModule.defaultClaudeProjectId(repoA),
    "github.com/acme/demo"
  );
  assert.equal(
    adapterModule.defaultClaudeProjectId(repoB),
    "github.com/acme/demo"
  );
});

test("defaultClaudeProjectId prefers upstream over other non-origin remotes", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-project-upstream-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  const adapterModule = await import("../dist/index.js");

  runGit(repoPath, ["init"]);
  runGit(repoPath, ["remote", "add", "backup", "https://github.com/acme/backup.git"]);
  runGit(repoPath, ["remote", "add", "upstream", "git@github.com:acme/demo.git"]);

  assert.equal(
    adapterModule.defaultClaudeProjectId(repoPath),
    "github.com/acme/demo"
  );
});

test("defaultClaudeProjectId fails closed when multiple non-priority remotes exist", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-project-ambiguous-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  const adapterModule = await import("../dist/index.js");

  runGit(repoPath, ["init"]);
  runGit(repoPath, ["remote", "add", "backup", "https://github.com/acme/backup.git"]);
  runGit(repoPath, ["remote", "add", "mirror", "git@github.com:acme/demo.git"]);

  assert.throws(() => adapterModule.defaultClaudeProjectId(repoPath));
});

test("defaultClaudeProjectId falls back to local repo identity without remote", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-project-local-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  const adapterModule = await import("../dist/index.js");

  runGit(repoPath, ["init"]);

  const projectId = adapterModule.defaultClaudeProjectId(repoPath);
  assert.ok(projectId.startsWith("local:"));
});

test("claude adapter does not emit unsupported destructive lifecycle events from hook normalization", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-safe-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-3",
      repo_id: "github.com/acme/demo",
    },
  });

  const events = adapter.capture({
    hook: "PostToolUse",
    tool_name: "UnknownTool",
    tool_input: {},
    tool_output: {},
  });

  assert.deepEqual(events, []);
  assert.equal(runtime.listEvents("github.com/acme/demo").length, 0);

  runtime.close();
});

test("claude adapter downgrades failed git revert attempts to command_result", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-git-revert-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-git-revert",
      repo_id: "github.com/acme/demo",
      branch: "main",
    },
  });

  adapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "git revert HEAD",
      cwd: "/repo",
    },
    tool_output: {
      stdout: "error: your local changes would be overwritten by revert",
    },
    exit_code: 1,
  });

  const events = runtime.listEvents("github.com/acme/demo");
  const outcomes = runtime.listOutcomes("github.com/acme/demo");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.event_type, "command_result");
  assert.ok(!outcomes.some((outcome) => outcome.outcome_type === "commit_reverted"));

  runtime.close();
});

test("claude adapter does not dedupe across different projects sharing a session id", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-dedupe-project-"));
  const adapterModule = await import("../dist/index.js");

  const contextA = {
    project_id: "github.com/acme/a",
    workspace_id: "ws-a",
    session_id: "shared-session",
    repo_id: "github.com/acme/a",
    branch: "main",
    cwd: "/repo-a",
  };
  const runtimeA = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapterA = new adapterModule.ClaudeCodeAdapter({
    runtime: runtimeA,
    context: contextA,
  });
  adapterA.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: "/repo-a",
      branch: "main",
    },
    tool_output: {
      stdout: "Windows install path normalizer failed",
      failing_test: "Windows install path normalizer",
    },
    exit_code: 1,
  });
  const first = adapterA.injectSessionBrief();
  runtimeA.close();

  const contextB = {
    project_id: "github.com/acme/b",
    workspace_id: "ws-b",
    session_id: "shared-session",
    repo_id: "github.com/acme/b",
    branch: "main",
    cwd: "/repo-b",
  };
  const runtimeB = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapterB = new adapterModule.ClaudeCodeAdapter({
    runtime: runtimeB,
    context: contextB,
  });
  adapterB.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: "/repo-b",
      branch: "main",
    },
    tool_output: {
      stdout: "Windows install path normalizer failed",
      failing_test: "Windows install path normalizer",
    },
    exit_code: 1,
  });
  const second = adapterB.injectSessionBrief();

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, false);
  runtimeB.close();
});

test("claude adapter only promotes successful git revert with verifiable output", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-git-revert-ok-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-git-revert-ok",
      repo_id: "github.com/acme/demo",
      branch: "main",
    },
  });

  adapter.record({
    hook: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "git revert HEAD",
      cwd: "/repo",
    },
    tool_output: {
      stdout: "[main 1234567] Revert \"Use wrong backend\"\n 1 file changed, 2 insertions(+), 2 deletions(-)\nThis reverts commit abcdef0.",
    },
    exit_code: 0,
  });

  const events = runtime.listEvents("github.com/acme/demo");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.event_type, "git_revert");

  runtime.close();
});
