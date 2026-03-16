#!/usr/bin/env node

import process from "node:process";
import {
  buildClaudeSessionStartHookOutput,
  executeClaudeHookEnvelope,
  type ClaudeHookEnvelope,
  type ClaudeHookExecutionOptions,
} from "./hook-envelope.js";

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): ClaudeHookExecutionOptions {
  const options: ClaudeHookExecutionOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    if (key === "enable-claude-hook-capture-paths") {
      options.enable_claude_hook_capture_paths = true;
      continue;
    }

    const value = argv[index + 1];
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
      default:
        fail(`unknown option: --${key}`);
    }

    index += 1;
  }

  return options;
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
  const options = parseArgs(process.argv.slice(2));
  const raw = await readStdin();
  const envelope = parseEnvelope(raw);
  const result = executeClaudeHookEnvelope(envelope, options);

  if (envelope.hook_event_name === "SessionStart" && result.injection) {
    const output = buildClaudeSessionStartHookOutput(result.injection);
    if (output) {
      process.stdout.write(`${output}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
