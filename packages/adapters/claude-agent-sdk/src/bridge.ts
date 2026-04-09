import path from "node:path";
import {
  executeClaudeHookEnvelope,
  findGitRoot,
  type ClaudeHookEnvelope,
  type ClaudeHookExecutionOptions,
} from "@slicenfer/project-memory-adapter-claude-code";
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  Options,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

export interface ProjectMemoryAgentSdkConfig {
  cwd?: string;
  dataDir?: string;
  dbPath?: string;
  project_id?: string;
  repo_id?: string;
  workspace_id?: string;
  branch?: string;
  agent_id?: string;
  agent_version?: string;
}

type SupportedHookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "SessionEnd"
  | "PreCompact"
  | "PostCompact"
  | "StopFailure"
  | "SubagentStop"
  | "Setup";

type SupportedHookInput = Extract<HookInput, { hook_event_name: SupportedHookEvent }>;

export const PROJECT_MEMORY_AGENT_SDK_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "StopFailure",
  "SubagentStop",
  "Setup",
] as const satisfies readonly SupportedHookEvent[];

const DEFAULT_AGENT_ID = "claude-agent-sdk";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeToolInput(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function normalizeToolResponse(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;

  const summary = stringifyUnknown(value);
  if (!summary) return undefined;

  return {
    summary,
    stdout: summary,
  };
}

function buildCommonEnvelope(input: SupportedHookInput, config: ProjectMemoryAgentSdkConfig) {
  return {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: path.resolve(config.cwd ?? input.cwd),
    permission_mode: input.permission_mode,
    model: "model" in input ? input.model : undefined,
  };
}

function buildExecutionOptions(
  config: ProjectMemoryAgentSdkConfig
): ClaudeHookExecutionOptions {
  return {
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    project_id: config.project_id,
    repo_id: config.repo_id,
    workspace_id: config.workspace_id,
    branch: config.branch,
    agent_id: config.agent_id ?? DEFAULT_AGENT_ID,
    agent_version: config.agent_version,
  };
}

export function mapHookInputToClaudeEnvelope(
  input: HookInput,
  config: ProjectMemoryAgentSdkConfig = {}
): ClaudeHookEnvelope | null {
  const common = buildCommonEnvelope(input as SupportedHookInput, config);

  switch (input.hook_event_name) {
    case "SessionStart":
      return {
        ...common,
        hook_event_name: "SessionStart",
        source: input.source,
        agent_type: input.agent_type,
      };

    case "UserPromptSubmit":
      return {
        ...common,
        hook_event_name: "UserPromptSubmit",
        prompt: input.prompt,
      };

    case "PreToolUse":
      return {
        ...common,
        hook_event_name: "PreToolUse",
        tool_name: input.tool_name,
        tool_input: normalizeToolInput(input.tool_input),
        tool_use_id: input.tool_use_id,
      };

    case "PostToolUse":
      return {
        ...common,
        hook_event_name: "PostToolUse",
        tool_name: input.tool_name,
        tool_input: normalizeToolInput(input.tool_input),
        tool_response: normalizeToolResponse(input.tool_response),
        tool_use_id: input.tool_use_id,
      };

    case "PostToolUseFailure":
      return {
        ...common,
        hook_event_name: "PostToolUseFailure",
        tool_name: input.tool_name,
        tool_input: normalizeToolInput(input.tool_input),
        tool_use_id: input.tool_use_id,
        error: input.error,
      };

    case "Stop":
      return {
        ...common,
        hook_event_name: "Stop",
        stop_hook_active: input.stop_hook_active,
        last_assistant_message: input.last_assistant_message,
      };

    case "SessionEnd":
      return {
        ...common,
        hook_event_name: "SessionEnd",
        reason: input.reason,
      };

    case "PreCompact":
      return {
        ...common,
        hook_event_name: "PreCompact",
      };

    case "PostCompact":
      return {
        ...common,
        hook_event_name: "PostCompact",
        trigger: input.trigger,
        compact_summary: input.compact_summary,
      };

    case "StopFailure":
      return {
        ...common,
        hook_event_name: "StopFailure",
        error: input.error,
        error_details: input.error_details,
        last_assistant_message: input.last_assistant_message,
      };

    case "SubagentStop":
      return {
        ...common,
        hook_event_name: "SubagentStop",
        stop_hook_active: input.stop_hook_active,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
        agent_transcript_path: input.agent_transcript_path,
        last_assistant_message: input.last_assistant_message,
      };

    case "Setup":
      return {
        ...common,
        hook_event_name: "Setup",
        trigger: input.trigger,
      };

    default:
      return null;
  }
}

function buildHookOutput(
  input: SupportedHookInput,
  result: ReturnType<typeof executeClaudeHookEnvelope>
): SyncHookJSONOutput {
  if (input.hook_event_name === "SessionStart" && result.injection?.text) {
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: result.injection.text,
      },
    };
  }

  if (input.hook_event_name === "UserPromptSubmit" && result.additionalContext) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: result.additionalContext,
      },
    };
  }

  if (input.hook_event_name === "PreToolUse" && result.additionalContext) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: result.additionalContext,
      },
    };
  }

  return {};
}

export function executeProjectMemorySdkHook(
  input: HookInput,
  config: ProjectMemoryAgentSdkConfig = {}
): SyncHookJSONOutput {
  const envelope = mapHookInputToClaudeEnvelope(input, config);
  if (!envelope) return {};

  if (!findGitRoot(envelope.cwd)) {
    return {};
  }

  const result = executeClaudeHookEnvelope(envelope, buildExecutionOptions(config));
  return buildHookOutput(input as SupportedHookInput, result);
}

export function createProjectMemoryHooks(
  config: ProjectMemoryAgentSdkConfig = {}
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

  for (const event of PROJECT_MEMORY_AGENT_SDK_HOOK_EVENTS) {
    hooks[event] = [
      {
        hooks: [
          async (input) => executeProjectMemorySdkHook(input, config),
        ],
      },
    ];
  }

  return hooks;
}

export function withProjectMemory(
  options: Options = {},
  config: ProjectMemoryAgentSdkConfig = {}
): Options {
  const pmrHooks = createProjectMemoryHooks(config);
  const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    ...(options.hooks ?? {}),
  };

  for (const event of PROJECT_MEMORY_AGENT_SDK_HOOK_EVENTS) {
    const existing = options.hooks?.[event] ?? [];
    const injected = pmrHooks[event] ?? [];
    mergedHooks[event] = [...existing, ...injected];
  }

  return {
    ...options,
    hooks: mergedHooks,
  };
}
