# Plan: Implement 6 New Claude Code Hooks for Project Memory

## Scope

Add 6 new hooks to the adapter layer — 3 high-ROI (Phase 1) + 3 medium-ROI (Phase 2):

| # | Hook | Action | Response |
|---|------|--------|----------|
| 1 | **UserPromptSubmit** | Record `user_message` event from raw user prompt | `additionalContext` — inject relevant memory |
| 2 | **PostCompact** | Record `session_end` event with `compact_summary` as content | None |
| 3 | **StopFailure** | Record `session_end` event + create interrupted-task thread | None |
| 4 | **SubagentStop** | Record `agent_message` event with sub-agent conclusions | None |
| 5 | **PreToolUse** (Bash only) | No event — query-only hook | `additionalContext` — inject relevant claims for the command |
| 6 | **Setup** (maintenance) | Run `sweepStaleClaims` + record lifecycle event | None |

## Architecture Decisions

### No new EventTypes, CapturePaths, or OutcomeTypes

All 6 hooks map to **existing** runtime event types:
- `UserPromptSubmit` → `user_message` (existing, uses `claude_code.hook.user_message` capture path)
- `PostCompact` → `session_end` (existing, no capture path — matches lifecycle pattern)
- `StopFailure` → `session_end` (existing, no capture path)
- `SubagentStop` → `agent_message` (existing, no capture path)
- `PreToolUse` → **no event recorded** (query-only)
- `Setup` → `session_start` (existing, no capture path)

This keeps the runtime core stable and focuses changes on the adapter layer.

### Response mechanism: additionalContext

Two hooks return `additionalContext` to inject memory into Claude's context:
1. **UserPromptSubmit** — lightweight brief (relevant claims for the user's query)
2. **PreToolUse** — command-relevant claims (e.g., "known build issues", "preferred test patterns")

Both use the same JSON response format as SessionStart:
```json
{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }
```

### PostCompact extracts claims from summary content

The `compact_summary` goes into the event's `content` field. Existing deterministic extractors (`extractPackageManager`, `extractTestFramework`, etc.) naturally pick up patterns from the summary text. No new extractors needed initially.

---

## File Changes

### 1. `packages/adapters/claude-code/src/hook-envelope.ts`

**Add 6 new envelope interfaces:**
```typescript
interface ClaudeUserPromptSubmitEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}
interface ClaudePostCompactEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PostCompact";
  trigger?: "manual" | "auto";
  compact_summary?: string;
}
interface ClaudeStopFailureEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "StopFailure";
  error?: unknown;
  error_details?: string;
  last_assistant_message?: string;
}
interface ClaudeSubagentStopEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "SubagentStop";
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
}
interface ClaudePreToolUseEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input?: unknown;
  tool_use_id?: string;
}
interface ClaudeSetupEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "Setup";
  trigger?: "init" | "maintenance";
}
```

**Extend `ClaudeHookEnvelopeName` union** with all 6 new names.

**Extend `ClaudeHookEnvelope` union** with all 6 new envelope types.

**Extend `parseClaudeHookEnvelope`** with 6 new switch cases that:
- Build appropriate `ClaudeAdapterInput` (lifecycle or tool payload)
- Set `shouldInjectSessionBrief: false` for all except UserPromptSubmit/PreToolUse
- Add new flag like `shouldInjectAdditionalContext` for UserPromptSubmit and PreToolUse
- For PreToolUse: set `isQueryOnly: true` (no event recording)

**Add new parsed envelope fields:**
```typescript
interface ParsedClaudeHookEnvelope {
  context: ClaudeAdapterContext;
  input: ClaudeAdapterInput | null;  // null for query-only hooks
  shouldInjectSessionBrief: boolean;
  shouldInjectAdditionalContext: boolean;  // NEW
  additionalContextQuery?: string;          // NEW — for PreToolUse/UserPromptSubmit
  maintenanceSweep?: boolean;               // NEW — for Setup maintenance
}
```

### 2. `packages/adapters/claude-code/src/hook-settings.ts`

**Extend `ClaudeManagedHookEvent`** with 6 new event names.

**Extend `MANAGED_HOOK_MATCHERS`:**
```typescript
UserPromptSubmit: undefined,       // fires on all user messages
PostCompact: "*",                  // all triggers
StopFailure: undefined,            // all failures
SubagentStop: undefined,           // all sub-agents
PreToolUse: "Bash",                // only Bash — minimizes latency overhead
Setup: "maintenance",              // only maintenance mode, skip init (handled by pmr init)
```

### 3. `packages/adapters/claude-code/src/adapter.ts`

**Add new payload interfaces:**
```typescript
interface ClaudeUserPromptSubmitPayload {
  hook: "UserPromptSubmit";
  prompt: string;
  ts?: string;
  metadata?: Record<string, unknown>;
}
interface ClaudeSubagentStopPayload {
  hook: "SubagentStop";
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  ts?: string;
  metadata?: Record<string, unknown>;
}
```

**Add normalization functions:**
- `normalizeUserPromptSubmit()` → `user_message` event with:
  - `capture_path: "claude_code.hook.user_message"` (reuses existing)
  - content: raw prompt
  - metadata: `{ source: "user_prompt_submit" }`
- `normalizePostCompact()` → `session_end` event with:
  - content: compact_summary (full text)
  - metadata: `{ hook_name: "PostCompact", trigger, compact_summary }`
- `normalizeStopFailure()` → `session_end` event with:
  - content: last_assistant_message or error summary
  - metadata: `{ hook_name: "StopFailure", error_details, last_assistant_message, is_error: true }`
- `normalizeSubagentStop()` → `agent_message` event with:
  - content: last_assistant_message or "Subagent completed"
  - metadata: `{ agent_id, agent_type, transcript_path }`

**Add `injectAdditionalContext()` method** to `ClaudeCodeAdapter`:
- Lighter than `injectSessionBrief` — uses `searchClaims` with the prompt/command as query
- Returns formatted context string or null
- Deduplication: no dedup needed (each prompt is unique)

**Extend `capture()` method** to dispatch new payload types.

### 4. `packages/adapters/claude-code/src/cli.ts`

**Extend main()** response handling:
```typescript
// After event recording...
if (["SessionStart", "UserPromptSubmit", "PreToolUse"].includes(envelope.hook_event_name)) {
  // Inject additionalContext response
  const context = buildAdditionalContextResponse(envelope, result);
  if (context) process.stdout.write(JSON.stringify(context) + "\n");
}

if (envelope.hook_event_name === "Setup" && parsed.maintenanceSweep) {
  runtime.sweepStaleClaims();
}
```

**UserPromptSubmit response format:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Project Memory: ...\nRelevant claims:\n- ..."
  }
}
```

**PreToolUse response format:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Memory notes for this command:\n- ..."
  }
}
```

### 5. Tests

**New test file: `packages/adapters/claude-code/tests/claude-new-hooks.test.mjs`**

Tests for each hook:
1. UserPromptSubmit records user_message event and returns additionalContext
2. PostCompact records session_end with compact_summary and extracts patterns
3. StopFailure records session_end with error metadata
4. SubagentStop records agent_message with sub-agent metadata
5. PreToolUse returns additionalContext without recording events
6. Setup maintenance triggers sweepStaleClaims

**Extend CLI E2E test** to verify UserPromptSubmit and PreToolUse return additionalContext.

---

## Implementation Order

1. **hook-settings.ts** — register all 6 new hooks in settings
2. **hook-envelope.ts** — add envelope types + parsing
3. **adapter.ts** — add payload types, normalization, and `injectAdditionalContext`
4. **cli.ts** — wire up response output and Setup sweep
5. **Tests** — add smoke tests and E2E tests
6. **Build + Test** — verify all pass

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| PreToolUse latency on every Bash call | Only match Bash, use lightweight searchClaims (no full brief) |
| UserPromptSubmit floods events | Dedup via hashId including prompt content + session_id |
| PostCompact summary too large | Truncate content to 4000 chars |
| Setup hook only fires rarely | That's fine — maintenance sweep is a bonus |
