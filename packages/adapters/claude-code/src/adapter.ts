import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import {
  type EventCapturePath,
  type EventScope,
  type NormalizedEvent,
  type ProjectMemoryRuntime,
  type RecallPacket,
  type RuntimeConfig,
} from "@slicenferqin/project-memory-runtime-core";
import { ProjectMemoryRuntime as Runtime } from "@slicenferqin/project-memory-runtime-core";

export type ClaudeHookName =
  | "SessionStart"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd"
  | "PreCompact";

export interface ClaudeAdapterContext {
  project_id: string;
  workspace_id?: string;
  session_id?: string;
  repo_id?: string;
  cwd?: string;
  branch?: string;
  agent_id?: string;
  agent_version?: string;
}

export interface ClaudePostToolUsePayload {
  hook: "PostToolUse";
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  success?: boolean;
  exit_code?: number;
  ts?: string;
}

export interface ClaudeSessionLifecyclePayload {
  hook: "SessionStart" | "Stop" | "SessionEnd" | "PreCompact";
  ts?: string;
  note?: string;
}

export interface ClaudeMessagePayload {
  kind: "user_message" | "user_confirmation";
  content: string;
  ts?: string;
  scope?: EventScope;
  metadata?: Record<string, unknown>;
}

export type ClaudeAdapterInput =
  | ClaudePostToolUsePayload
  | ClaudeSessionLifecyclePayload
  | ClaudeMessagePayload;

export interface ClaudeInjectionResult {
  packet: RecallPacket;
  text: string | null;
  deduped: boolean;
  packet_hash: string;
}

export interface ClaudeAdapterOptions {
  runtime: ProjectMemoryRuntime;
  context: ClaudeAdapterContext;
}

const CLAUDE_ALLOWED_CAPTURE_PATHS: EventCapturePath[] = [
  "fixture.user_confirmation",
  "fixture.user_message",
  "import.transcript",
  "system.tool_observation",
  "operator.manual",
  "claude_code.hook.user_confirmation",
  "claude_code.hook.user_message",
];

function nowIso(): string {
  return new Date().toISOString();
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildScope(context: ClaudeAdapterContext, scope?: EventScope): EventScope | undefined {
  const normalized: EventScope = {};
  if (context.repo_id) normalized.repo = context.repo_id;
  if (context.branch) normalized.branch = context.branch;
  if (context.cwd) normalized.cwd = context.cwd;
  if (scope?.repo) normalized.repo = scope.repo;
  if (scope?.branch) normalized.branch = scope.branch;
  if (scope?.cwd) normalized.cwd = scope.cwd;
  if (scope?.files?.length) normalized.files = [...scope.files];
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function eventBase(
  context: ClaudeAdapterContext,
  input: { ts?: string; event_type: NormalizedEvent["event_type"]; content: string }
): Omit<NormalizedEvent, "id"> {
  return {
    ts: input.ts ?? nowIso(),
    project_id: context.project_id,
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    repo_id: context.repo_id,
    agent_id: context.agent_id ?? "claude-code",
    agent_version: context.agent_version ?? "unknown",
    event_type: input.event_type,
    content: input.content,
  };
}

function classifyBashCommand(command: string): NormalizedEvent["event_type"] {
  const normalized = command.toLowerCase();
  if (/\b(?:pnpm|npm|yarn|bun)\s+(test|vitest|jest|pytest)\b/.test(normalized)) {
    return "test_result";
  }
  if (/\b(?:pnpm|npm|yarn|bun)\s+build\b/.test(normalized)) {
    return "build_result";
  }
  if (/\b(?:pnpm|npm|yarn|bun)\s+lint\b/.test(normalized)) {
    return "lint_result";
  }
  if (/\bgit\s+commit\b/.test(normalized)) return "git_commit";
  if (/\bgit\s+revert\b/.test(normalized)) return "git_revert";
  return "command_result";
}

function normalizePostToolUse(
  context: ClaudeAdapterContext,
  payload: ClaudePostToolUsePayload
): NormalizedEvent[] {
  const toolName = payload.tool_name.toLowerCase();
  const ts = payload.ts ?? nowIso();
  const events: NormalizedEvent[] = [];

  if (toolName === "bash") {
    const command = asString(payload.tool_input?.command) ?? asString(payload.tool_input?.cmd) ?? "bash";
    const eventType = classifyBashCommand(command);
    const content =
      asString(payload.tool_output?.stdout) ??
      asString(payload.tool_output?.summary) ??
      command;
    const scope = buildScope(context, {
      branch: asString(payload.tool_input?.branch),
      cwd: asString(payload.tool_input?.cwd),
      files:
        Array.isArray(payload.tool_input?.files) &&
        payload.tool_input?.files.every((value) => typeof value === "string")
          ? (payload.tool_input.files as string[])
          : undefined,
    });

    events.push({
      ...eventBase(context, {
        ts,
        event_type: eventType,
        content,
      }),
      id: `evt-${hashValue([context.project_id, context.session_id, payload.hook, payload.tool_name, ts, command])}`,
      capture_path: "system.tool_observation",
      scope,
      metadata: {
        command,
        exit_code:
          typeof payload.exit_code === "number"
            ? payload.exit_code
            : payload.success === false
              ? 1
              : 0,
        failing_test: asString(payload.tool_output?.failing_test),
      },
    });
    return events;
  }

  if (toolName === "write" || toolName === "edit" || toolName === "multiedit") {
    const filePath = asString(payload.tool_input?.file_path) ?? asString(payload.tool_input?.path);
    const content =
      asString(payload.tool_output?.summary) ??
      asString(payload.tool_output?.stdout) ??
      `${payload.tool_name} updated ${filePath ?? "workspace files"}`;

    events.push({
      ...eventBase(context, {
        ts,
        event_type: "file_edit",
        content,
      }),
      id: `evt-${hashValue([context.project_id, context.session_id, payload.hook, payload.tool_name, ts, filePath])}`,
      capture_path: "system.tool_observation",
      scope: buildScope(context, filePath ? { files: [filePath] } : undefined),
      metadata: filePath ? { files: [filePath] } : undefined,
    });
  }

  return events;
}

function normalizeLifecycleEvent(
  context: ClaudeAdapterContext,
  payload: ClaudeSessionLifecyclePayload
): NormalizedEvent[] {
  const ts = payload.ts ?? nowIso();
  const eventType =
    payload.hook === "SessionStart"
      ? "session_start"
      : payload.hook === "PreCompact"
        ? "session_end"
        : "session_end";

  const content =
    payload.note ??
    (payload.hook === "SessionStart"
      ? "Claude Code session started"
      : `Claude Code lifecycle signal: ${payload.hook}`);

  return [
    {
      ...eventBase(context, {
        ts,
        event_type: eventType,
        content,
      }),
      id: `evt-${hashValue([context.project_id, context.session_id, payload.hook, ts])}`,
      metadata: {
        hook_name: payload.hook,
      },
    },
  ];
}

function normalizeMessageEvent(
  context: ClaudeAdapterContext,
  payload: ClaudeMessagePayload
): NormalizedEvent[] {
  const capturePath: EventCapturePath =
    payload.kind === "user_confirmation"
      ? "claude_code.hook.user_confirmation"
      : "claude_code.hook.user_message";

  return [
    {
      ...eventBase(context, {
        ts: payload.ts ?? nowIso(),
        event_type: payload.kind,
        content: payload.content,
      }),
      id: `evt-${hashValue([context.project_id, context.session_id, payload.kind, payload.ts ?? "", payload.content, payload.scope ?? null])}`,
      capture_path: capturePath,
      scope: buildScope(context, payload.scope),
      metadata: payload.metadata,
    },
  ];
}

function formatInjection(packet: RecallPacket): string {
  const lines: string[] = [];
  lines.push("Project Memory");
  lines.push(packet.brief);
  if (packet.active_claims.length > 0) {
    lines.push("");
    lines.push("Active claims:");
    for (const claim of packet.active_claims.slice(0, 5)) {
      lines.push(`- ${claim.canonical_key}: ${claim.content}`);
    }
  }
  if (packet.open_threads.length > 0) {
    lines.push("");
    lines.push("Open threads:");
    for (const thread of packet.open_threads.slice(0, 5)) {
      lines.push(`- ${thread.canonical_key}: ${thread.content}`);
    }
  }
  return lines.join("\n");
}

export function createClaudeCodeRuntime(config: RuntimeConfig = {}): ProjectMemoryRuntime {
  return new Runtime({
    ...config,
    allowed_capture_paths: Array.from(
      new Set([...(config.allowed_capture_paths ?? []), ...CLAUDE_ALLOWED_CAPTURE_PATHS])
    ),
  });
}

export class ClaudeCodeAdapter {
  private readonly runtime: ProjectMemoryRuntime;
  private readonly context: ClaudeAdapterContext;
  private readonly sessionPacketHashes = new Map<string, string>();

  constructor(options: ClaudeAdapterOptions) {
    this.runtime = options.runtime;
    this.context = options.context;
  }

  capture(input: ClaudeAdapterInput): NormalizedEvent[] {
    if ("hook" in input) {
      if (input.hook === "PostToolUse") {
        return normalizePostToolUse(this.context, input);
      }
      return normalizeLifecycleEvent(this.context, input);
    }

    return normalizeMessageEvent(this.context, input);
  }

  record(input: ClaudeAdapterInput): NormalizedEvent[] {
    const events = this.capture(input);
    for (const event of events) {
      this.runtime.recordEvent(event);
    }
    return events;
  }

  injectSessionBrief(): ClaudeInjectionResult {
    const packet = this.runtime.buildSessionBrief({
      project_id: this.context.project_id,
      session_id: this.context.session_id,
      workspace_id: this.context.workspace_id,
      agent_id: this.context.agent_id ?? "claude-code",
      scope: buildScope(this.context),
    });

    const packetHash = hashValue({
      brief: packet.brief,
      active_claims: packet.active_claims.map((claim) => claim.id),
      open_threads: packet.open_threads.map((claim) => claim.id),
    });
    const sessionKey = this.context.session_id ?? this.context.workspace_id ?? this.context.project_id;
    const previous = this.sessionPacketHashes.get(sessionKey);

    if (previous === packetHash) {
      return {
        packet,
        text: null,
        deduped: true,
        packet_hash: packetHash,
      };
    }

    this.sessionPacketHashes.set(sessionKey, packetHash);
    return {
      packet,
      text: formatInjection(packet),
      deduped: false,
      packet_hash: packetHash,
    };
  }
}

export function defaultClaudeProjectId(cwdPath: string = process.cwd()): string {
  return path.resolve(cwdPath);
}
