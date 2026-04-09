import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import {
  type ClaimScope,
  type EventCapturePath,
  type EventScope,
  type NormalizedEvent,
  type ProjectMemoryRuntime,
  type RecallPacket,
  type RuntimeConfig,
  type SessionCheckpointSource,
  nowIso,
  asString,
} from "@slicenfer/project-memory-runtime-core";
import { ProjectMemoryRuntime as Runtime } from "@slicenfer/project-memory-runtime-core";
import { detectWorkspace, type WorkspaceInfo } from "./workspace.js";

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
  hook: "PostToolUse" | "PostToolUseFailure";
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  success?: boolean;
  exit_code?: number;
  ts?: string;
  metadata?: Record<string, unknown>;
}

export interface ClaudeSessionLifecyclePayload {
  hook: "SessionStart" | "Stop" | "SessionEnd" | "PreCompact";
  ts?: string;
  note?: string;
  metadata?: Record<string, unknown>;
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

export interface ClaudeCodeRuntimeConfig extends RuntimeConfig {
  enable_claude_hook_capture_paths?: boolean;
}

const CLAUDE_TRUSTED_HOOK_CAPTURE_PATHS: EventCapturePath[] = [
  "claude_code.hook.user_confirmation",
  "claude_code.hook.user_message",
];

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function artifactRefForPayload(dataDir: string, payload: unknown): string {
  const serialized = JSON.stringify(payload, null, 2);
  const digest = sha256(serialized);
  const artifactsDir = path.join(dataDir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const artifactPath = path.join(artifactsDir, `${digest}.json`);
  if (!fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, `${serialized}\n`);
  }
  return path.relative(dataDir, artifactPath);
}

function summarizeBashObservation(input: {
  command: string;
  eventType: NormalizedEvent["event_type"];
  exitCode: number;
  toolOutput?: Record<string, unknown>;
}): string {
  const failingTest = asString(input.toolOutput?.failing_test);
  const summaryText =
    asString(input.toolOutput?.summary) ??
    asString(input.toolOutput?.stderr) ??
    asString(input.toolOutput?.stdout);
  const outcomeLabel = input.exitCode === 0 ? "succeeded" : "failed";

  if (input.eventType === "test_result" && failingTest) {
    return `Command ${outcomeLabel}: ${input.command} | failing test: ${failingTest}`;
  }

  if (summaryText) {
    return `Command ${outcomeLabel}: ${input.command} | ${truncate(normalizeInlineText(summaryText), 220)}`;
  }

  return `Command ${outcomeLabel}: ${input.command}`;
}

function buildBaseScope(context: ClaudeAdapterContext): EventScope | undefined {
  const normalized: EventScope = {};
  if (context.repo_id) normalized.repo = context.repo_id;
  if (context.branch) normalized.branch = context.branch;
  if (context.cwd) normalized.cwd = context.cwd;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildRecallScope(context: ClaudeAdapterContext): ClaimScope | undefined {
  const normalized: ClaimScope = {};
  if (context.repo_id) normalized.repo = context.repo_id;
  if (context.branch) normalized.branch = context.branch;
  if (context.cwd) normalized.cwd_prefix = context.cwd;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isSameOrDescendantPath(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeFiles(baseCwd: string | undefined, files: string[] | undefined): string[] | undefined {
  if (!baseCwd || !files?.length) return undefined;

  const normalized = files
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => path.resolve(baseCwd, value))
    .filter((value) => isSameOrDescendantPath(baseCwd, value));

  return normalized.length > 0 ? normalized : undefined;
}

function buildMessageScope(context: ClaudeAdapterContext, scope?: EventScope): EventScope | undefined {
  const normalized = buildBaseScope(context) ?? {};
  // Trusted user paths must stay bound to the current session context.
  const files = sanitizeFiles(normalized.cwd, scope?.files);
  if (files) normalized.files = files;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildToolObservationScope(
  context: ClaudeAdapterContext,
  scope?: EventScope
): EventScope | undefined {
  const normalized = buildBaseScope(context) ?? {};
  if (scope?.cwd) {
    if (!normalized.cwd || isSameOrDescendantPath(normalized.cwd, scope.cwd)) {
      normalized.cwd = scope.cwd;
    }
  }
  const files = sanitizeFiles(normalized.cwd, scope?.files);
  if (files) normalized.files = files;
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

function looksLikeSuccessfulGitCommit(output: string): boolean {
  return /^\[[^\]]+\]\s+/m.test(output) || /\bfiles? changed\b/i.test(output);
}

function looksLikeSuccessfulGitRevert(output: string): boolean {
  return /\bthis reverts commit\b/i.test(output) || /^\[[^\]]+\]\s+revert\b/im.test(output);
}

function classifyBashCommand(
  command: string,
  exitCode: number,
  toolOutputText: string
): NormalizedEvent["event_type"] {
  const normalized = command.toLowerCase();
  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(test|vitest|jest|pytest)\b/.test(normalized)) {
    return "test_result";
  }
  if (/\bnode\s+--test\b/.test(normalized)) {
    return "test_result";
  }
  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b/.test(normalized)) {
    return "build_result";
  }
  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?lint\b/.test(normalized)) {
    return "lint_result";
  }
  if (/\bgit\s+commit\b/.test(normalized)) {
    if (exitCode !== 0) return "command_result";
    return looksLikeSuccessfulGitCommit(toolOutputText) ? "git_commit" : "command_result";
  }
  if (/\bgit\s+revert\b/.test(normalized)) {
    if (exitCode !== 0) return "command_result";
    return looksLikeSuccessfulGitRevert(toolOutputText) ? "git_revert" : "command_result";
  }
  return "command_result";
}

function normalizePostToolUse(
  context: ClaudeAdapterContext,
  payload: ClaudePostToolUsePayload,
  artifactsDataDir: string
): NormalizedEvent[] {
  const toolName = payload.tool_name.toLowerCase();
  const ts = payload.ts ?? nowIso();
  const events: NormalizedEvent[] = [];

  if (toolName === "bash") {
    const command = asString(payload.tool_input?.command) ?? asString(payload.tool_input?.cmd) ?? "bash";
    const exitCode =
      typeof payload.exit_code === "number"
        ? payload.exit_code
        : payload.success === false
          ? 1
          : 0;
    const eventType = classifyBashCommand(
      command,
      exitCode,
      asString(payload.tool_output?.stdout) ??
        asString(payload.tool_output?.summary) ??
        command
    );
    const scope = buildToolObservationScope(context, {
      branch: asString(payload.tool_input?.branch),
      cwd: asString(payload.tool_input?.cwd),
      files:
        Array.isArray(payload.tool_input?.files) &&
        payload.tool_input?.files.every((value) => typeof value === "string")
          ? (payload.tool_input.files as string[])
          : undefined,
    });
    const artifactRef = artifactRefForPayload(
      artifactsDataDir,
      {
        hook: payload.hook,
        tool_name: payload.tool_name,
        tool_input: payload.tool_input,
        tool_output: payload.tool_output,
        metadata: payload.metadata,
        ts,
      }
    );
    const content = summarizeBashObservation({
      command,
      eventType,
      exitCode,
      toolOutput: payload.tool_output,
    });
    const touchedFiles =
      Array.isArray(payload.tool_output?.touched_files) &&
      payload.tool_output.touched_files.every((value) => typeof value === "string")
        ? (payload.tool_output.touched_files as string[])
        : scope?.files;

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
        command_name: command,
        exit_code: exitCode,
        duration_ms:
          typeof payload.metadata?.duration_ms === "number"
            ? payload.metadata.duration_ms
            : undefined,
        touched_files: touchedFiles,
        stdout_digest: asString(payload.tool_output?.stdout)
          ? sha256(asString(payload.tool_output?.stdout)!)
          : undefined,
        stderr_digest: asString(payload.tool_output?.stderr)
          ? sha256(asString(payload.tool_output?.stderr)!)
          : undefined,
        artifact_ref: artifactRef,
        build_command: eventType === "build_result" ? command : undefined,
        failing_test: asString(payload.tool_output?.failing_test),
        ...(payload.metadata ?? {}),
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
      scope: buildToolObservationScope(context, filePath ? { files: [filePath] } : undefined),
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
        ...(payload.metadata ?? {}),
      },
    },
  ];
}

function normalizeMessageEvent(
  context: ClaudeAdapterContext,
  payload: ClaudeMessagePayload
): NormalizedEvent[] {
  return [
    {
      ...eventBase(context, {
        ts: payload.ts ?? nowIso(),
        event_type: payload.kind,
        content: payload.content,
      }),
      id: `evt-${hashValue([context.project_id, context.session_id, payload.kind, payload.ts ?? "", payload.content, payload.scope ?? null])}`,
      capture_path: "import.transcript",
      scope: buildMessageScope(context, payload.scope),
      metadata: payload.metadata,
    },
  ];
}

function formatOutcomeBadge(claim: RecallPacket["active_claims"][number]): string {
  const summary = claim.outcome_summary;
  if (!summary) return "";
  if (summary.positive_count === 0 && summary.negative_count === 0) return "";

  const parts: string[] = [];
  if (summary.positive_count > 0) {
    const types = summary.outcome_types
      .filter((t) => ["test_pass", "build_pass", "commit_kept", "issue_closed", "human_kept"].includes(t))
      .map((t) => t.replace(/_/g, " "));
    parts.push(`${summary.positive_count} ${types.join(", ") || "pass"}`);
  }
  if (summary.negative_count > 0) {
    parts.push(`${summary.negative_count} negative`);
  }

  const icon = summary.negative_count === 0 ? "✓" : "⚠";
  return ` [${icon} verified: ${parts.join(" | ")} | confidence: ${claim.confidence.toFixed(2)}]`;
}

function formatInjection(packet: RecallPacket): string {
  const lines: string[] = [];
  lines.push("Project Memory");
  lines.push(packet.brief);
  if (packet.checkpoint) {
    lines.push("");
    lines.push("Continuation checkpoint:");
    lines.push(`- Summary: ${packet.checkpoint.summary}`);
    if (packet.checkpoint.current_goal) {
      lines.push(`- Current goal: ${packet.checkpoint.current_goal}`);
    }
    if (packet.checkpoint.next_action) {
      lines.push(`- Next action: ${packet.checkpoint.next_action}`);
    }
    if (packet.checkpoint.blocking_reason) {
      lines.push(`- Blocking: ${packet.checkpoint.blocking_reason}`);
    }
  }
  if (packet.active_claims.length > 0) {
    lines.push("");
    lines.push("Active claims:");
    for (const claim of packet.active_claims.slice(0, 5)) {
      const badge = formatOutcomeBadge(claim);
      lines.push(`- ${claim.canonical_key}: ${claim.content}${badge}`);
    }
  }
  if (packet.open_threads.length > 0) {
    lines.push("");
    lines.push("Open threads:");
    for (const thread of packet.open_threads.slice(0, 5)) {
      const badge = formatOutcomeBadge(thread);
      lines.push(`- ${thread.canonical_key}: ${thread.content}${badge}`);
    }
  }
  if (packet.warnings?.length) {
    lines.push("");
    for (const w of packet.warnings) {
      lines.push(`⚠ ${w}`);
    }
  }
  return lines.join("\n");
}

function buildSessionMarkerKey(context: ClaudeAdapterContext): string {
  return hashValue({
    project_id: context.project_id,
    workspace_id: context.workspace_id ?? null,
    session_id: context.session_id ?? null,
  });
}

function readSessionMarker(markerPath: string): string | undefined {
  try {
    const raw = fs.readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(raw) as { packet_hash?: string };
    return typeof parsed.packet_hash === "string" ? parsed.packet_hash : undefined;
  } catch {
    return undefined;
  }
}

function writeSessionMarker(markerPath: string, packetHash: string): void {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        packet_hash: packetHash,
        updated_at: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function runGit(cwdPath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwdPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeGitRemote(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return undefined;

  const scpLike = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^#?]+)$/i);
  if (scpLike) {
    const host = scpLike[1].toLowerCase();
    const repoPath = scpLike[2].replace(/\.git$/i, "").replace(/^\/+/, "");
    return `${host}/${repoPath}`;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const repoPath = parsed.pathname.replace(/\.git$/i, "").replace(/^\/+/, "");
    if (!repoPath) return undefined;
    return `${host}/${repoPath}`;
  } catch {
    return undefined;
  }
}

function defaultLocalProjectId(cwdPath: string): string {
  const realPath = fs.realpathSync.native?.(cwdPath) ?? fs.realpathSync(cwdPath);
  return `local:${sha256(realPath)}`;
}

export function createClaudeCodeRuntime(
  config: ClaudeCodeRuntimeConfig = {}
): ProjectMemoryRuntime {
  const {
    enable_claude_hook_capture_paths = false,
    ...runtimeConfig
  } = config;

  const requestedCapturePaths = runtimeConfig.allowed_capture_paths ?? [];
  const requestedTrustedHookPaths = requestedCapturePaths.filter((capturePath) =>
    CLAUDE_TRUSTED_HOOK_CAPTURE_PATHS.includes(capturePath)
  );

  if (!enable_claude_hook_capture_paths) {
    if (requestedTrustedHookPaths.length > 0) {
      throw new Error(
        "claude_code.hook.* capture paths require enable_claude_hook_capture_paths=true"
      );
    }
    return new Runtime(runtimeConfig);
  }

  return new Runtime({
    ...runtimeConfig,
    allowed_capture_paths: Array.from(
      new Set([
        ...(runtimeConfig.allowed_capture_paths ?? []),
        ...CLAUDE_TRUSTED_HOOK_CAPTURE_PATHS,
      ])
    ),
  });
}

export class ClaudeCodeAdapter {
  private readonly runtime: ProjectMemoryRuntime;
  private context: ClaudeAdapterContext;
  private readonly sessionPacketHashes = new Map<string, string>();
  private currentWorkspace: WorkspaceInfo | null = null;
  private readonly autoDetectWorkspace: boolean;

  constructor(options: ClaudeAdapterOptions & { autoDetectWorkspace?: boolean }) {
    this.runtime = options.runtime;
    this.context = options.context;
    this.autoDetectWorkspace = options.autoDetectWorkspace ?? false;

    if (this.autoDetectWorkspace) {
      this.updateWorkspaceContext();
    }
  }

  private updateWorkspaceContext(): void {
    const cwd = this.context.cwd ?? process.cwd();
    const workspace = detectWorkspace(cwd);

    if (!this.currentWorkspace || this.currentWorkspace.workspace_root !== workspace.workspace_root) {
      this.currentWorkspace = workspace;
      this.context = {
        ...this.context,
        project_id: workspace.project_id,
        workspace_id: workspace.project_id,
      };
    }
  }

  capture(input: ClaudeAdapterInput): NormalizedEvent[] {
    if ("hook" in input) {
      if (input.hook === "PostToolUse" || input.hook === "PostToolUseFailure") {
        return normalizePostToolUse(this.context, input, this.runtime.getPaths().dataDir);
      }
      return normalizeLifecycleEvent(this.context, input as ClaudeSessionLifecyclePayload);
    }

    return normalizeMessageEvent(this.context, input);
  }

  record(input: ClaudeAdapterInput | null): NormalizedEvent[] {
    if (!input) return [];

    if (this.autoDetectWorkspace) {
      this.updateWorkspaceContext();
    }

    const events = this.capture(input);
    for (const event of events) {
      this.runtime.recordEvent(event);
    }

    return events;
  }

  recordSessionCheckpoint(
    source: SessionCheckpointSource,
    hints: { summaryHint?: string; blockingHint?: string } = {}
  ) {
    if (!this.context.session_id) return undefined;

    return this.runtime.recordSessionCheckpoint({
      project_id: this.context.project_id,
      session_id: this.context.session_id,
      workspace_id: this.context.workspace_id,
      agent_id: this.context.agent_id ?? "claude-code",
      scope: buildRecallScope(this.context),
      cwd: this.context.cwd,
      source,
      summary_hint: hints.summaryHint,
      blocking_hint: hints.blockingHint,
    });
  }

  injectSessionBrief(): ClaudeInjectionResult {
    const packet = this.runtime.buildSessionBrief({
      project_id: this.context.project_id,
      session_id: this.context.session_id,
      workspace_id: this.context.workspace_id,
      agent_id: this.context.agent_id ?? "claude-code",
      scope: buildRecallScope(this.context),
      cwd: this.context.cwd,
    });

    const packetHash = hashValue({
      brief: packet.brief,
      checkpoint: packet.checkpoint
        ? {
            id: packet.checkpoint.id,
            status: packet.checkpoint.status,
            summary: packet.checkpoint.summary,
            current_goal: packet.checkpoint.current_goal,
            next_action: packet.checkpoint.next_action,
          }
        : null,
      active_claims: packet.active_claims.map((claim) => claim.id),
      open_threads: packet.open_threads.map((claim) => claim.id),
      warnings: packet.warnings ?? [],
    });
    const sessionKey = buildSessionMarkerKey(this.context);
    const markerPath = path.join(
      this.runtime.getPaths().dataDir,
      "claude-code",
      "session-brief-markers",
      `${sessionKey}.json`
    );
    const previous =
      this.sessionPacketHashes.get(sessionKey) ?? readSessionMarker(markerPath);

    if (previous === packetHash) {
      this.sessionPacketHashes.set(sessionKey, packetHash);
      return {
        packet,
        text: null,
        deduped: true,
        packet_hash: packetHash,
      };
    }

    this.sessionPacketHashes.set(sessionKey, packetHash);
    writeSessionMarker(markerPath, packetHash);
    return {
      packet,
      text: formatInjection(packet),
      deduped: false,
      packet_hash: packetHash,
    };
  }

  injectAdditionalContext(query: string): string | null {
    if (!query.trim()) return null;

    const packet = this.runtime.searchClaims({
      project_id: this.context.project_id,
      query,
      scope: buildRecallScope(this.context),
      limit: 5,
    });

    const hasClaims = packet.active_claims.length > 0 || packet.open_threads.length > 0;
    if (!hasClaims) return null;

    return formatInjection(packet);
  }
}

export function defaultClaudeProjectId(cwdPath: string = process.cwd()): string {
  const gitRoot = runGit(cwdPath, ["rev-parse", "--show-toplevel"]);
  const repoRoot = gitRoot ? path.resolve(gitRoot) : path.resolve(cwdPath);

  const remotes = (runGit(repoRoot, ["remote"]) ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const remoteName = remotes.includes("origin")
    ? "origin"
    : remotes.includes("upstream")
      ? "upstream"
      : remotes.length === 1
        ? remotes[0]
        : undefined;

  if (remoteName) {
    const remoteUrl = runGit(repoRoot, ["remote", "get-url", remoteName]);
    const normalizedRemote = remoteUrl ? normalizeGitRemote(remoteUrl) : undefined;
    if (normalizedRemote) return normalizedRemote;
  }

  if (remotes.length > 1) {
    throw new Error(
      "defaultClaudeProjectId requires explicit project_id when multiple non-priority remotes exist"
    );
  }

  return defaultLocalProjectId(repoRoot);
}

export function defaultClaudeWorkspaceId(cwdPath: string = process.cwd()): string {
  const gitRoot = runGit(cwdPath, ["rev-parse", "--show-toplevel"]);
  const workspaceRoot = gitRoot ? path.resolve(gitRoot) : path.resolve(cwdPath);
  const realPath = fs.realpathSync.native?.(workspaceRoot) ?? fs.realpathSync(workspaceRoot);
  return sha256(realPath);
}

export function defaultClaudeBranch(cwdPath: string = process.cwd()): string | undefined {
  const gitRoot = runGit(cwdPath, ["rev-parse", "--show-toplevel"]);
  const repoRoot = gitRoot ? path.resolve(gitRoot) : path.resolve(cwdPath);
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return undefined;
  return branch;
}
