import fs from "node:fs";
import path from "node:path";
import type { ClaudeHookExecutionOptions } from "./hook-envelope.js";

export type ClaudeManagedHookEvent =
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

export interface ClaudeCommandHookConfig {
  type: "command";
  command: string;
  timeout?: number;
}

export interface ClaudeHookMatcherConfig {
  matcher?: string;
  hooks: ClaudeCommandHookConfig[];
}

export interface ClaudeHookSettings {
  hooks?: Record<string, ClaudeHookMatcherConfig[]>;
  [key: string]: unknown;
}

export interface ClaudeHookSettingsOptions extends ClaudeHookExecutionOptions {
  command?: string;
  timeout_seconds?: number;
}

export interface ClaudeHookSettingsInstallOptions extends ClaudeHookSettingsOptions {
  settings_file?: string;
}

export interface ClaudeHookSettingsInstallResult {
  settings_file: string;
  settings: ClaudeHookSettings;
  managed_command: string;
}

export interface ClaudeHookSettingsValidationResult {
  settings_file: string;
  is_valid: boolean;
  managed_events: ClaudeManagedHookEvent[];
  missing_events: ClaudeManagedHookEvent[];
  duplicate_events: Partial<Record<ClaudeManagedHookEvent, number>>;
}

export const CLAUDE_MANAGED_HOOK_MARKER = "# project-memory-runtime-managed-claude-hook";
export const DEFAULT_CLAUDE_HOOK_COMMAND =
  'cd "$CLAUDE_PROJECT_DIR" && node ./packages/adapters/claude-code/dist/cli.js';
export const DEFAULT_CLAUDE_HOOK_DATA_DIR = "$CLAUDE_PROJECT_DIR/.memory/project-memory";

const DEFAULT_TIMEOUT_SECONDS = 10;

const MANAGED_HOOK_MATCHERS: Record<ClaudeManagedHookEvent, string | undefined> = {
  SessionStart: "startup|resume|clear|compact",
  PostToolUse: "Bash|Edit|MultiEdit|Write",
  PostToolUseFailure: "Bash",
  Stop: undefined,
  SessionEnd: "*",
  PreCompact: "*",
  UserPromptSubmit: undefined,
  PostCompact: "*",
  StopFailure: undefined,
  SubagentStop: undefined,
  PreToolUse: "Bash",
  Setup: "maintenance",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function shellQuote(value: string): string {
  if (value.length === 0) return '""';
  if (value.includes("$")) {
    return `"${value.replace(/(["\\`])/g, "\\$1")}"`;
  }
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function maybePushStringArg(args: string[], key: string, value: string | undefined): void {
  if (!value) return;
  args.push(`--${key}`, shellQuote(value));
}

function buildManagedHookArgs(options: ClaudeHookSettingsOptions): string[] {
  const args: string[] = [];
  maybePushStringArg(args, "data-dir", options.dataDir ?? DEFAULT_CLAUDE_HOOK_DATA_DIR);
  maybePushStringArg(args, "db-path", options.dbPath);
  maybePushStringArg(args, "project-id", options.project_id);
  maybePushStringArg(args, "repo-id", options.repo_id);
  maybePushStringArg(args, "workspace-id", options.workspace_id);
  maybePushStringArg(args, "branch", options.branch);
  maybePushStringArg(args, "agent-id", options.agent_id);
  maybePushStringArg(args, "agent-version", options.agent_version);
  if (options.enable_claude_hook_capture_paths) {
    args.push("--enable-claude-hook-capture-paths");
  }
  return args;
}

function matcherKey(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isManagedCommandHook(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "command" &&
    typeof value.command === "string" &&
    value.command.includes(CLAUDE_MANAGED_HOOK_MARKER)
  );
}

function normalizeHookEntries(value: unknown): ClaudeHookMatcherConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => isRecord(entry))
    .map((entry) => {
      const hooks = Array.isArray(entry.hooks)
        ? entry.hooks.filter(
            (hook): hook is ClaudeCommandHookConfig =>
              isRecord(hook) &&
              hook.type === "command" &&
              typeof hook.command === "string" &&
              (hook.timeout === undefined || typeof hook.timeout === "number")
          )
        : [];

      return {
        ...(typeof entry.matcher === "string" ? { matcher: entry.matcher } : {}),
        hooks,
      };
    })
    .filter((entry) => entry.hooks.length > 0);
}

function resolveSettingsFile(settingsFile?: string): string {
  return path.resolve(
    settingsFile ?? path.join(process.cwd(), ".claude", "settings.local.json")
  );
}

function loadClaudeHookSettings(settingsFile: string): ClaudeHookSettings {
  if (!fs.existsSync(settingsFile)) {
    return {};
  }

  const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`invalid Claude settings JSON at ${settingsFile}`);
  }
  return cloneJson(parsed) as ClaudeHookSettings;
}

function mergeManagedEventHooks(
  existingEntries: unknown,
  generatedEntries: ClaudeHookMatcherConfig[]
): ClaudeHookMatcherConfig[] {
  const strippedEntries = normalizeHookEntries(existingEntries)
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((hook) => !isManagedCommandHook(hook)),
    }))
    .filter((entry) => entry.hooks.length > 0);

  for (const generatedEntry of generatedEntries) {
    const existingEntry = strippedEntries.find(
      (entry) => matcherKey(entry.matcher) === matcherKey(generatedEntry.matcher)
    );

    if (existingEntry) {
      existingEntry.hooks.push(...generatedEntry.hooks);
      if (generatedEntry.matcher === undefined) {
        delete existingEntry.matcher;
      } else {
        existingEntry.matcher = generatedEntry.matcher;
      }
      continue;
    }

    strippedEntries.push(cloneJson(generatedEntry));
  }

  return strippedEntries;
}

export function buildClaudeHookCommand(options: ClaudeHookSettingsOptions = {}): string {
  const baseCommand = (options.command ?? DEFAULT_CLAUDE_HOOK_COMMAND).trim();
  const args = buildManagedHookArgs(options);
  return [baseCommand, ...args, CLAUDE_MANAGED_HOOK_MARKER].join(" ");
}

export function buildClaudeHookSettings(
  options: ClaudeHookSettingsOptions = {}
): ClaudeHookSettings {
  const timeout = options.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
  const command = buildClaudeHookCommand(options);
  const hook: ClaudeCommandHookConfig = {
    type: "command",
    command,
    timeout,
  };

  const hooks = Object.fromEntries(
    Object.entries(MANAGED_HOOK_MATCHERS).map(([eventName, matcher]) => [
      eventName,
      [
        {
          ...(matcher ? { matcher } : {}),
          hooks: [cloneJson(hook)],
        },
      ],
    ])
  ) as Record<string, ClaudeHookMatcherConfig[]>;

  return { hooks };
}

export function installClaudeHookSettings(
  options: ClaudeHookSettingsInstallOptions = {}
): ClaudeHookSettingsInstallResult {
  const settingsFile = resolveSettingsFile(options.settings_file);
  const settings = loadClaudeHookSettings(settingsFile);
  const generatedSettings = buildClaudeHookSettings(options);
  const currentHooks = isRecord(settings.hooks) ? cloneJson(settings.hooks) : {};
  const generatedHooks = generatedSettings.hooks ?? {};

  for (const eventName of Object.keys(MANAGED_HOOK_MATCHERS) as ClaudeManagedHookEvent[]) {
    currentHooks[eventName] = mergeManagedEventHooks(
      currentHooks[eventName],
      generatedHooks[eventName] ?? []
    );
  }

  settings.hooks = currentHooks;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  return {
    settings_file: settingsFile,
    settings,
    managed_command: buildClaudeHookCommand(options),
  };
}

export function validateClaudeHookSettings(
  options: { settings_file?: string } = {}
): ClaudeHookSettingsValidationResult {
  const settingsFile = resolveSettingsFile(options.settings_file);
  const settings = loadClaudeHookSettings(settingsFile);
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};

  const managedEvents: ClaudeManagedHookEvent[] = [];
  const missingEvents: ClaudeManagedHookEvent[] = [];
  const duplicateEvents: Partial<Record<ClaudeManagedHookEvent, number>> = {};

  for (const eventName of Object.keys(MANAGED_HOOK_MATCHERS) as ClaudeManagedHookEvent[]) {
    const managedHookCount = normalizeHookEntries(hooks[eventName])
      .flatMap((entry) => entry.hooks)
      .filter((hook) => isManagedCommandHook(hook)).length;

    if (managedHookCount === 1) {
      managedEvents.push(eventName);
      continue;
    }

    if (managedHookCount === 0) {
      missingEvents.push(eventName);
      continue;
    }

    duplicateEvents[eventName] = managedHookCount;
  }

  return {
    settings_file: settingsFile,
    is_valid: missingEvents.length === 0 && Object.keys(duplicateEvents).length === 0,
    managed_events: managedEvents,
    missing_events: missingEvents,
    duplicate_events: duplicateEvents,
  };
}
