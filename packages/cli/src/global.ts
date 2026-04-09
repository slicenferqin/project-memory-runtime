import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function resolveGlobalHookCommand(): string {
  // 1. Global bin (e.g. `npm install -g project-memory-runtime`)
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const globalBin = execFileSync(whichCmd, ["project-memory-claude-hook"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (globalBin) return "project-memory-claude-hook";
  } catch {
    // fall through
  }

  // 2. Local monorepo dist (dev / local build scenarios)
  //    This file lives at cli/dist/global.js after build. Walk up to find the
  //    sibling adapter's compiled CLI.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      // When running compiled cli (cli/dist/global.js)
      path.resolve(here, "..", "..", "adapters", "claude-code", "dist", "cli.js"),
      // When running via ts-node / source (cli/src/global.ts)
      path.resolve(here, "..", "..", "..", "adapters", "claude-code", "dist", "cli.js"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        // Absolute path + node; JSON.stringify escapes spaces/quotes safely.
        return `node ${JSON.stringify(candidate)}`;
      }
    }
  } catch {
    // fall through
  }

  // 3. npx fallback — works once the package is published to npm.
  return "npx --yes @slicenfer/project-memory-adapter-claude-code";
}

function skillAssetPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "SKILL.md");
}

function defaultSkillContent(mode: "global" | "local"): string {
  const header =
    mode === "global"
      ? "Your coding environment has a global Project Memory runtime."
      : "Your project has a Project Memory runtime installed locally.";

  return [
    "---",
    "name: project-memory",
    "autoApply: always",
    "---",
    "# Project Memory — Evidence-backed recall",
    "",
    header,
    "It tracks verified decisions, facts, open threads, and continuation checkpoints.",
    "",
    "## Auto-injection",
    "Session brief and continuation checkpoint can be injected automatically via Claude hooks.",
    "",
    "## Mid-session retrieval",
    "When you need to recall project decisions or check evidence, use Bash:",
    '- `pmr search "<query>"` — find relevant decisions, facts, threads',
    "- `pmr explain <claim-id>` — trace a claim to its evidence and outcomes",
    "- `pmr snapshot` — full project memory overview",
    "- `pmr status` — memory database statistics",
    "",
    "## When to use",
    '- User asks "why did we decide X?" → `pmr search "X"`',
    "- User questions a past decision → `pmr explain <id>` to show evidence",
    "- Starting complex work → `pmr snapshot` for full context",
    "- Resuming a session → inspect the continuation checkpoint in `pmr snapshot`",
  ].join("\n");
}

export function installProjectMemorySkill(skillBaseDir: string, mode: "global" | "local"): string {
  const skillDir = path.join(skillBaseDir, "project-memory");
  const skillFile = path.join(skillDir, "SKILL.md");
  let content: string;

  const assetSkill = skillAssetPath();
  if (fs.existsSync(assetSkill)) {
    content = fs.readFileSync(assetSkill, "utf8");
    if (mode === "global") {
      content = content.replace(
        "Your project has a memory system that tracks verified decisions, facts,",
        "Your coding environment has a global memory system that tracks verified decisions, facts,"
      );
    }
  } else {
    content = defaultSkillContent(mode);
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, content);
  return skillFile;
}
