import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

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
    events.some((event) => event.capture_path === "claude_code.hook.user_confirmation")
  );
  assert.ok(
    events.some((event) => event.capture_path === "claude_code.hook.user_message")
  );
  assert.ok(
    events.some(
      (event) =>
        event.capture_path === "system.tool_observation" && event.event_type === "test_result"
    )
  );
  assert.ok(
    claims.some((claim) => claim.canonical_key === "decision.persistence.backend")
  );
  assert.ok(
    claims.some((claim) => claim.canonical_key === "thread.blocker.windows.install")
  );
  assert.ok(
    claims.some((claim) => claim.canonical_key === "thread.test.windows.install.path.normalizer")
  );

  runtime.close();
});

test("claude adapter injects session brief once per unchanged packet", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-brief-"));
  const adapterModule = await import("../dist/index.js");

  const runtime = adapterModule.createClaudeCodeRuntime({ dataDir: tempDir });
  const adapter = new adapterModule.ClaudeCodeAdapter({
    runtime,
    context: {
      project_id: "github.com/acme/demo",
      workspace_id: "ws-1",
      session_id: "session-2",
      repo_id: "github.com/acme/demo",
      branch: "main",
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

  const first = adapter.injectSessionBrief();
  const second = adapter.injectSessionBrief();

  assert.equal(first.deduped, false);
  assert.ok(first.text?.includes("Project Memory"));
  assert.equal(second.deduped, true);
  assert.equal(second.text, null);

  runtime.close();
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
