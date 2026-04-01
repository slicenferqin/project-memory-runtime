import path from "node:path";
import { type NormalizedEvent, asString } from "@slicenferqin/project-memory-runtime-core";
import {
  ClaudeCodeAdapter,
  createClaudeCodeRuntime,
  defaultClaudeBranch,
  defaultClaudeProjectId,
  defaultClaudeWorkspaceId,
  type ClaudeAdapterContext,
  type ClaudeAdapterInput,
  type ClaudeCodeRuntimeConfig,
  type ClaudeInjectionResult,
} from "./adapter.js";

export type ClaudeHookEnvelopeName =
  | "SessionStart"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "SessionEnd"
  | "PreCompact"
  | "UserPromptSubmit"
  | "PostCompact"
  | "StopFailure"
  | "SubagentStop"
  | "PreToolUse"
  | "Setup";

export interface ClaudeHookEnvelopeBase {
  hook_event_name: ClaudeHookEnvelopeName;
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: string;
  model?: string;
}

export interface ClaudeSessionStartEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "SessionStart";
  source?: string;
  agent_type?: string;
}

export interface ClaudePostToolUseEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PostToolUse" | "PostToolUseFailure";
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
  success?: boolean;
  exit_code?: number;
  error?: string;
}

export interface ClaudeStopEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "Stop";
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

export interface ClaudeSessionEndEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "SessionEnd";
  reason?: string;
}

export interface ClaudePreCompactEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PreCompact";
}

export interface ClaudeUserPromptSubmitEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "UserPromptSubmit";
  prompt?: string;
}

export interface ClaudePostCompactEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PostCompact";
  trigger?: "manual" | "auto";
  compact_summary?: string;
}

export interface ClaudeStopFailureEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "StopFailure";
  error?: unknown;
  error_details?: string;
  last_assistant_message?: string;
}

export interface ClaudeSubagentStopEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "SubagentStop";
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

export interface ClaudePreToolUseEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
}

export interface ClaudeSetupEnvelope extends ClaudeHookEnvelopeBase {
  hook_event_name: "Setup";
  trigger?: "init" | "maintenance";
}

export type ClaudeHookEnvelope =
  | ClaudeSessionStartEnvelope
  | ClaudePostToolUseEnvelope
  | ClaudeStopEnvelope
  | ClaudeSessionEndEnvelope
  | ClaudePreCompactEnvelope
  | ClaudeUserPromptSubmitEnvelope
  | ClaudePostCompactEnvelope
  | ClaudeStopFailureEnvelope
  | ClaudeSubagentStopEnvelope
  | ClaudePreToolUseEnvelope
  | ClaudeSetupEnvelope;

export interface ClaudeHookExecutionOptions extends ClaudeCodeRuntimeConfig {
  project_id?: string;
  repo_id?: string;
  workspace_id?: string;
  branch?: string;
  agent_id?: string;
  agent_version?: string;
}

export interface ParsedClaudeHookEnvelope {
  context: ClaudeAdapterContext;
  input: ClaudeAdapterInput | null;
  shouldInjectSessionBrief: boolean;
  shouldInjectAdditionalContext: boolean;
  additionalContextQuery?: string;
  maintenanceSweep?: boolean;
}

export interface ClaudeHookExecutionResult {
  context: ClaudeAdapterContext;
  events: NormalizedEvent[];
  injection?: ClaudeInjectionResult;
  additionalContext?: string | null;
  staleClaimed?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inferExitCode(envelope: ClaudePostToolUseEnvelope): number | undefined {
  if (typeof envelope.exit_code === "number") return envelope.exit_code;
  if (typeof envelope.success === "boolean") return envelope.success ? 0 : 1;
  const errorText = envelope.error ?? "";
  const match = errorText.match(/status code\s+(\d+)/i);
  if (match) return Number(match[1]);
  return envelope.hook_event_name === "PostToolUseFailure" ? 1 : undefined;
}

function inferFailingTestFromText(text: string): string | undefined {
  const patterns = [
    /test failed:\s*(.+)$/i,
    /failing test:\s*(.+)$/i,
    /(.+?)\s+failed$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim().replace(/^["']|["']$/g, "");
      if (candidate.length > 0) return candidate;
    }
  }

  return undefined;
}

function deriveContext(
  envelope: ClaudeHookEnvelope,
  options: ClaudeHookExecutionOptions = {}
): ClaudeAdapterContext {
  const cwd = path.resolve(envelope.cwd);
  const repoId = options.repo_id ?? defaultClaudeProjectId(cwd);
  const projectId = options.project_id ?? repoId;
  const workspaceId = options.workspace_id ?? defaultClaudeWorkspaceId(cwd);
  const branch = options.branch ?? defaultClaudeBranch(cwd);

  return {
    project_id: projectId,
    repo_id: repoId,
    workspace_id: workspaceId,
    session_id: envelope.session_id,
    cwd,
    branch,
    agent_id: options.agent_id ?? "claude-code",
    agent_version: options.agent_version ?? envelope.model ?? "unknown",
  };
}

export function parseClaudeHookEnvelope(
  envelope: ClaudeHookEnvelope,
  options: ClaudeHookExecutionOptions = {}
): ParsedClaudeHookEnvelope {
  const context = deriveContext(envelope, options);
  const baseMetadata = {
    hook_event_name: envelope.hook_event_name,
    transcript_path: envelope.transcript_path,
    permission_mode: envelope.permission_mode,
    model: envelope.model,
  };

  switch (envelope.hook_event_name) {
    case "SessionStart":
      return {
        context,
        shouldInjectSessionBrief: true,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "SessionStart",
          note: `Claude Code session started (${envelope.source ?? "unknown"})`,
          metadata: {
            ...baseMetadata,
            source: envelope.source,
            agent_type: envelope.agent_type,
          },
        },
      };
    case "PostToolUse":
    case "PostToolUseFailure": {
      const toolResponse = asRecord(envelope.tool_response);
      const error = asString(envelope.error);
      const summary =
        asString(toolResponse?.stdout) ??
        asString(toolResponse?.stderr) ??
        asString(toolResponse?.summary) ??
        error ??
        envelope.tool_name;
      const exitCode = inferExitCode(envelope);
      const failingTest =
        asString(toolResponse?.failing_test) ??
        (error ? inferFailingTestFromText(error) : undefined) ??
        inferFailingTestFromText(summary);

      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: envelope.hook_event_name,
          tool_name: envelope.tool_name,
          tool_input: asRecord(envelope.tool_input),
          tool_output: {
            ...(toolResponse ?? {}),
            summary,
            stdout: asString(toolResponse?.stdout) ?? error ?? summary,
            failing_test: failingTest,
          },
          success:
            typeof envelope.success === "boolean"
              ? envelope.success
              : envelope.hook_event_name !== "PostToolUseFailure",
          exit_code: exitCode,
          metadata: {
            ...baseMetadata,
            tool_use_id: envelope.tool_use_id,
            error,
          },
        },
      };
    }
    case "Stop":
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "Stop",
          note: envelope.last_assistant_message ?? "Claude Code stop hook fired",
          metadata: {
            ...baseMetadata,
            stop_hook_active: envelope.stop_hook_active,
            last_assistant_message: envelope.last_assistant_message,
          },
        },
      };
    case "SessionEnd":
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "SessionEnd",
          note: envelope.reason ? `Claude Code session ended: ${envelope.reason}` : undefined,
          metadata: {
            ...baseMetadata,
            reason: envelope.reason,
          },
        },
      };
    case "PreCompact":
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "PreCompact",
          note: "Claude Code pre-compact lifecycle signal",
          metadata: baseMetadata,
        },
      };

    // ─── New hooks ──────────────────────────────────────────────

    case "UserPromptSubmit": {
      const prompt = asString(envelope.prompt) ?? "";
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: true,
        additionalContextQuery: prompt,
        input: {
          kind: "user_message",
          content: prompt,
          metadata: {
            ...baseMetadata,
            source: "user_prompt_submit",
          },
        },
      };
    }

    case "PostCompact": {
      const summary = asString(envelope.compact_summary) ?? "Context compacted";
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "SessionEnd",
          note: summary,
          metadata: {
            ...baseMetadata,
            trigger: envelope.trigger,
            compact_summary: envelope.compact_summary,
            source: "post_compact",
          },
        },
      };
    }

    case "StopFailure": {
      const errorDetails = asString(envelope.error_details) ?? String(envelope.error ?? "unknown error");
      const lastMsg = asString(envelope.last_assistant_message);
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "SessionEnd",
          note: lastMsg
            ? `Claude Code stopped by API error (partial response preserved): ${lastMsg.slice(0, 200)}`
            : `Claude Code stopped by API error: ${errorDetails.slice(0, 200)}`,
          metadata: {
            ...baseMetadata,
            error_details: errorDetails,
            last_assistant_message: lastMsg,
            is_error: true,
            source: "stop_failure",
          },
        },
      };
    }

    case "SubagentStop": {
      const lastMsg = asString(envelope.last_assistant_message) ?? "Subagent completed";
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        input: {
          hook: "Stop",
          note: lastMsg,
          metadata: {
            ...baseMetadata,
            subagent_id: envelope.agent_id,
            subagent_type: envelope.agent_type,
            transcript_path: envelope.agent_transcript_path,
            source: "subagent_stop",
          },
        },
      };
    }

    case "PreToolUse": {
      const command = asString(asRecord(envelope.tool_input)?.command) ?? envelope.tool_name;
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: true,
        additionalContextQuery: command,
        input: null, // query-only — no event recorded
      };
    }

    case "Setup": {
      const isMaintenanceSweep = envelope.trigger === "maintenance";
      return {
        context,
        shouldInjectSessionBrief: false,
        shouldInjectAdditionalContext: false,
        maintenanceSweep: isMaintenanceSweep,
        input: {
          hook: "SessionStart",
          note: `Claude Code setup: ${envelope.trigger ?? "unknown"}`,
          metadata: {
            ...baseMetadata,
            trigger: envelope.trigger,
            source: "setup",
          },
        },
      };
    }
  }
}

export function buildClaudeSessionStartHookOutput(
  result: ClaudeInjectionResult
): string | null {
  if (result.deduped) return null;
  const hasValue =
    result.packet.active_claims.length > 0 || result.packet.open_threads.length > 0;
  if (!hasValue || !result.text) return null;

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: result.text,
    },
  });
}

export function executeClaudeHookEnvelope(
  envelope: ClaudeHookEnvelope,
  options: ClaudeHookExecutionOptions = {}
): ClaudeHookExecutionResult {
  const parsed = parseClaudeHookEnvelope(envelope, options);
  const runtime = createClaudeCodeRuntime(options);

  try {
    const adapter = new ClaudeCodeAdapter({
      runtime,
      context: parsed.context,
    });

    // Record events (skip for query-only hooks like PreToolUse where input is null)
    const events = parsed.input ? adapter.record(parsed.input) : [];

    // Session brief injection (SessionStart only)
    const injection = parsed.shouldInjectSessionBrief
      ? adapter.injectSessionBrief()
      : undefined;

    // Additional context injection (UserPromptSubmit, PreToolUse)
    const additionalContext = parsed.shouldInjectAdditionalContext
      ? adapter.injectAdditionalContext(parsed.additionalContextQuery ?? "")
      : undefined;

    // Maintenance sweep (Setup with trigger=maintenance)
    const staleClaimed = parsed.maintenanceSweep
      ? runtime.sweepStaleClaims()
      : undefined;

    return {
      context: parsed.context,
      events,
      injection,
      additionalContext,
      staleClaimed,
    };
  } finally {
    runtime.close();
  }
}
