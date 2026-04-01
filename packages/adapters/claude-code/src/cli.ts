#!/usr/bin/env node

import process from "node:process";
import {
  buildClaudeSessionStartHookOutput,
  executeClaudeHookEnvelope,
  type ClaudeHookEnvelope,
  type ClaudeHookExecutionOptions,
} from "./hook-envelope.js";
import {
  buildClaudeHookSettings,
  installClaudeHookSettings,
  validateClaudeHookSettings,
  type ClaudeHookSettingsInstallOptions,
  type ClaudeHookSettingsOptions,
} from "./hook-settings.js";

function fail(message: string): never {
  throw new Error(message);
}

type ClaudeHookCliMode =
  | "run"
  | "print-settings"
  | "install-settings"
  | "validate-settings";

interface ParsedCliArgs {
  mode: ClaudeHookCliMode;
  options: ClaudeHookExecutionOptions & ClaudeHookSettingsInstallOptions;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const tokens = [...argv];
  if (tokens[0] === "--") {
    tokens.shift();
  }
  const firstToken = tokens[0];
  const mode: ClaudeHookCliMode =
    firstToken && !firstToken.startsWith("--")
      ? (tokens.shift() as ClaudeHookCliMode)
      : "run";

  if (!["run", "print-settings", "install-settings", "validate-settings"].includes(mode)) {
    fail(`unknown command: ${mode}`);
  }

  const options: ClaudeHookExecutionOptions & ClaudeHookSettingsInstallOptions = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    if (key === "enable-claude-hook-capture-paths") {
      options.enable_claude_hook_capture_paths = true;
      continue;
    }

    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }

    switch (key) {
      case "data-dir":
        options.dataDir = value;
        break;
      case "db-path":
        options.dbPath = value;
        break;
      case "project-id":
        options.project_id = value;
        break;
      case "repo-id":
        options.repo_id = value;
        break;
      case "workspace-id":
        options.workspace_id = value;
        break;
      case "branch":
        options.branch = value;
        break;
      case "agent-id":
        options.agent_id = value;
        break;
      case "agent-version":
        options.agent_version = value;
        break;
      case "command":
        options.command = value;
        break;
      case "settings-file":
        options.settings_file = value;
        break;
      case "timeout-seconds": {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          fail("--timeout-seconds must be a positive integer");
        }
        options.timeout_seconds = parsed;
        break;
      }
      default:
        fail(`unknown option: --${key}`);
    }

    index += 1;
  }

  return { mode, options };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEnvelope(raw: string): ClaudeHookEnvelope {
  if (!raw.trim()) fail("expected Claude hook envelope JSON on stdin");
  const parsed = JSON.parse(raw) as ClaudeHookEnvelope;
  if (!parsed || typeof parsed !== "object") {
    fail("invalid Claude hook envelope");
  }
  if (
    typeof parsed.hook_event_name !== "string" ||
    typeof parsed.session_id !== "string" ||
    typeof parsed.cwd !== "string"
  ) {
    fail("Claude hook envelope is missing required fields");
  }
  return parsed;
}

async function main(): Promise<void> {
  const { mode, options } = parseArgs(process.argv.slice(2));

  if (mode === "print-settings") {
    const settings = buildClaudeHookSettings(options as ClaudeHookSettingsOptions);
    process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
    return;
  }

  if (mode === "install-settings") {
    const result = installClaudeHookSettings(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (mode === "validate-settings") {
    const result = validateClaudeHookSettings(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.is_valid) {
      process.exitCode = 1;
    }
    return;
  }

  const raw = await readStdin();
  const envelope = parseEnvelope(raw);
  const result = executeClaudeHookEnvelope(envelope, options);

  // SessionStart: inject session brief
  if (envelope.hook_event_name === "SessionStart" && result.injection) {
    const output = buildClaudeSessionStartHookOutput(result.injection);
    if (output) {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  // UserPromptSubmit / PreToolUse: inject additional context
  if (result.additionalContext) {
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: envelope.hook_event_name,
        additionalContext: result.additionalContext,
      },
    });
    process.stdout.write(`${output}\n`);
    return;
  }

  // Setup maintenance: log sweep results
  if (typeof result.staleClaimed === "number" && result.staleClaimed > 0) {
    process.stderr.write(`project-memory: swept ${result.staleClaimed} stale claim(s)\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
