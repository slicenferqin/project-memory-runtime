import test from "node:test";
import assert from "node:assert/strict";

const COMMON = {
  session_id: "session-1",
  transcript_path: "/repo/.claude/transcript.jsonl",
  cwd: "/repo",
  permission_mode: "acceptEdits",
};

test("mapHookInputToClaudeEnvelope maps all supported SDK hook events", async () => {
  const mod = await import("../dist/bridge.js");

  const cases = [
    {
      input: {
        ...COMMON,
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-sonnet-4-6",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "SessionStart");
        assert.equal(envelope.source, "startup");
        assert.equal(envelope.model, "claude-sonnet-4-6");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "UserPromptSubmit",
        prompt: "run the tests",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "UserPromptSubmit");
        assert.equal(envelope.prompt, "run the tests");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_use_id: "tool-1",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "PreToolUse");
        assert.deepEqual(envelope.tool_input, { command: "pnpm test" });
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: "ok",
        tool_use_id: "tool-2",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "PostToolUse");
        assert.deepEqual(envelope.tool_response, { summary: "ok", stdout: "ok" });
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_use_id: "tool-3",
        error: "status code 1",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "PostToolUseFailure");
        assert.equal(envelope.error, "status code 1");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "done",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "Stop");
        assert.equal(envelope.last_assistant_message, "done");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "SessionEnd",
        reason: "completed",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "SessionEnd");
        assert.equal(envelope.reason, "completed");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "PreCompact",
        trigger: "auto",
        custom_instructions: null,
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "PreCompact");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "PostCompact",
        trigger: "manual",
        compact_summary: "compacted",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "PostCompact");
        assert.equal(envelope.compact_summary, "compacted");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "StopFailure",
        error: "server_error",
        error_details: "request failed",
        last_assistant_message: "partial result",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "StopFailure");
        assert.equal(envelope.error_details, "request failed");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "SubagentStop",
        stop_hook_active: true,
        agent_id: "subagent-1",
        agent_type: "general-purpose",
        agent_transcript_path: "/repo/.claude/subagent.jsonl",
        last_assistant_message: "fixed it",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "SubagentStop");
        assert.equal(envelope.agent_id, "subagent-1");
      },
    },
    {
      input: {
        ...COMMON,
        hook_event_name: "Setup",
        trigger: "maintenance",
      },
      verify: (envelope) => {
        assert.equal(envelope.hook_event_name, "Setup");
        assert.equal(envelope.trigger, "maintenance");
      },
    },
  ];

  for (const testCase of cases) {
    const envelope = mod.mapHookInputToClaudeEnvelope(testCase.input);
    assert.ok(envelope);
    testCase.verify(envelope);
  }
});

test("mapHookInputToClaudeEnvelope ignores unsupported SDK hook events", async () => {
  const mod = await import("../dist/bridge.js");
  const envelope = mod.mapHookInputToClaudeEnvelope({
    ...COMMON,
    hook_event_name: "Notification",
    message: "status update",
    notification_type: "info",
  });
  assert.equal(envelope, null);
});
