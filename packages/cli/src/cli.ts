#!/usr/bin/env node

import process from "node:process";
import { runInit } from "./commands/init.js";
import { runInstallGlobal } from "./commands/install-global.js";
import { runSearch } from "./commands/search.js";
import { runExplain } from "./commands/explain.js";
import { runSnapshot } from "./commands/snapshot.js";
import { runStatus } from "./commands/status.js";
import { runValidateGlobal } from "./commands/validate-global.js";
import { runUninstallGlobal } from "./commands/uninstall-global.js";

function parseArgs(argv: string[]): { positional: string[]; options: Record<string, string | boolean | string[]> } {
  const positional: string[] = [];
  const options: Record<string, string | boolean | string[]> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i++;
  }

  return { positional, options };
}

function usage(): string {
  return [
    "Project Memory Runtime — evidence-backed lifecycle memory for AI coding agents",
    "",
    "Usage: pmr <command> [options]",
    "",
    "Commands:",
    "  init                          Initialize project memory in the current repository",
    "  install-global                Install global Claude hooks, skill, and shared storage",
    "  validate-global               Validate global Project Memory installation",
    "  uninstall-global              Remove global Project Memory hooks, skill, and config",
    '  search "<query>"              Search project memory for relevant claims',
    "  explain <claim-id>            Trace a claim to its evidence and outcomes",
    "  snapshot                      Full project memory overview",
    "  status                        Memory database statistics",
    "",
    "Search options:",
    "  --type <decision|fact|thread> Filter by claim type",
    "  --status <active|stale>       Filter by claim status",
    "  --limit <N>                   Limit number of results",
    "",
    "Init options:",
    "  --data-dir <path>             Custom data directory (default: .memory)",
    "  --command <cmd>               Custom hook command",
    "",
    "Shared options:",
    "  --data-dir <path>             Data directory path",
    "  --project-id <id>             Explicit project ID",
    "  --json                        Output raw JSON",
    "  --help                        Show this help message",
  ].join("\n");
}

async function main(): Promise<void> {
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (positional.length === 0 || options.help) {
    console.log(usage());
    return;
  }

  const command = positional[0];

  switch (command) {
    case "init":
      await runInit(options);
      break;
    case "install-global":
      await runInstallGlobal(options);
      break;
    case "validate-global":
      await runValidateGlobal();
      break;
    case "uninstall-global":
      await runUninstallGlobal();
      break;
    case "search":
      runSearch(positional.slice(1), options);
      break;
    case "explain":
      runExplain(positional.slice(1), options);
      break;
    case "snapshot":
      runSnapshot(options);
      break;
    case "status":
      runStatus(options);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(usage());
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
