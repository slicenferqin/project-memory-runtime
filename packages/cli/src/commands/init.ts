import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ProjectMemoryRuntime } from "@slicenferqin/project-memory-runtime-core";
import {
  defaultClaudeProjectId,
  installClaudeHookSettings,
  validateClaudeHookSettings,
} from "@slicenferqin/project-memory-adapter-claude-code";
import type { CliOptions } from "../shared.js";

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function resolveHookCommand(projectDir: string): string {
  // Strategy 1: Check if project-memory-claude-hook is globally available
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const globalBin = execFileSync(whichCmd, ["project-memory-claude-hook"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (globalBin) return `project-memory-claude-hook`;
  } catch {
    // Not globally installed, continue
  }

  // Strategy 2: Use npx with the CLI package (most portable for npm users)
  // Check if we're in the monorepo dev context
  const monorepoCli = path.join(projectDir, "packages", "adapters", "claude-code", "dist", "cli.js");
  if (fs.existsSync(monorepoCli)) {
    const relative = path.relative(projectDir, monorepoCli);
    return `cd "$CLAUDE_PROJECT_DIR" && node ./${relative}`;
  }

  // Strategy 3: Try to resolve via node_modules
  const localCli = path.join(projectDir, "node_modules", ".bin", "project-memory-claude-hook");
  if (fs.existsSync(localCli)) {
    return `cd "$CLAUDE_PROJECT_DIR" && npx project-memory-claude-hook`;
  }

  // Strategy 4: Fallback to npx (will download if needed)
  return `npx --yes @slicenferqin/project-memory-adapter-claude-code`;
}

function installSkill(projectDir: string): string {
  const skillDir = path.join(projectDir, ".claude", "skills", "project-memory");
  const skillFile = path.join(skillDir, "SKILL.md");

  // Read skill template from our assets
  const assetSkill = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "SKILL.md");
  let content: string;

  if (fs.existsSync(assetSkill)) {
    content = fs.readFileSync(assetSkill, "utf8");
  } else {
    // Inline fallback if assets not available
    content = [
      "---",
      "name: project-memory",
      "autoApply: always",
      "---",
      "# Project Memory — Evidence-backed recall",
      "",
      "Your project has a memory system that tracks verified decisions, facts,",
      "and open threads. Memory is captured automatically from your tool use.",
      "",
      "## Auto-injection",
      "Session brief is injected automatically at session start via hooks.",
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
      '- Debugging a failure → `pmr search --type thread` for open issues',
    ].join("\n");
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, content);
  return skillFile;
}

export async function runInit(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const errors: string[] = [];
  const steps: { label: string; detail: string }[] = [];

  // Step 1: Detect git root
  const gitRoot = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const projectDir = gitRoot ? path.resolve(gitRoot) : path.resolve(cwd);

  if (!gitRoot) {
    console.log("⚠ Not a git repository. Using current directory as project root.");
  }

  // Step 2: Derive project_id
  let projectId: string;
  try {
    projectId = typeof options["project-id"] === "string"
      ? options["project-id"]
      : defaultClaudeProjectId(projectDir);
    steps.push({ label: "Project", detail: projectId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to derive project ID: ${message}`);
    console.error(`✗ ${errors[errors.length - 1]}`);
    process.exitCode = 1;
    return;
  }

  // Step 3: Create data directory and initialize DB
  const dataDir = typeof options["data-dir"] === "string"
    ? path.resolve(options["data-dir"])
    : path.join(projectDir, ".memory");

  let runtime: ProjectMemoryRuntime | undefined;
  try {
    runtime = new ProjectMemoryRuntime({ dataDir });
    runtime.initialize();
    const dbPath = runtime.getPaths().dbPath;
    steps.push({ label: "Database", detail: `${path.relative(projectDir, dbPath)} (${fs.existsSync(dbPath) ? "ready" : "created"})` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Database initialization failed: ${message}`);
  } finally {
    runtime?.close();
  }

  // Step 4: Install hooks
  const hookCommand = typeof options.command === "string"
    ? options.command
    : resolveHookCommand(projectDir);

  try {
    const settingsFile = path.join(projectDir, ".claude", "settings.local.json");
    const result = installClaudeHookSettings({
      settings_file: settingsFile,
      command: hookCommand,
      dataDir,
    });
    const hookCount = Object.keys(result.settings.hooks ?? {}).length;
    steps.push({ label: "Hooks", detail: `${hookCount} lifecycle hooks installed` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Hook installation failed: ${message}`);
  }

  // Step 5: Install Skill file
  try {
    installSkill(projectDir);
    steps.push({ label: "Skill", detail: `project-memory retrieval skill installed` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Skill installation failed: ${message}`);
  }

  // Step 6: Validate
  try {
    const settingsFile = path.join(projectDir, ".claude", "settings.local.json");
    const validation = validateClaudeHookSettings({ settings_file: settingsFile });
    if (validation.is_valid) {
      steps.push({ label: "Validation", detail: "all checks passed" });
    } else {
      errors.push(`Validation: missing hooks for ${validation.missing_events.join(", ")}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Validation failed: ${message}`);
  }

  // Step 7: Add .memory to .gitignore if not present
  try {
    const gitignorePath = path.join(projectDir, ".gitignore");
    let gitignore = "";
    if (fs.existsSync(gitignorePath)) {
      gitignore = fs.readFileSync(gitignorePath, "utf8");
    }
    if (!gitignore.includes(".memory")) {
      const entry = gitignore.endsWith("\n") || gitignore.length === 0
        ? ".memory/\n"
        : "\n.memory/\n";
      fs.appendFileSync(gitignorePath, entry);
    }
  } catch {
    // Non-critical, skip silently
  }

  // Output results
  console.log("");
  for (const step of steps) {
    console.log(`  ✓ ${step.label}: ${step.detail}`);
  }
  for (const err of errors) {
    console.log(`  ✗ ${err}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ${errors.length} issue(s) found. Check above for details.`);
    process.exitCode = 1;
  } else {
    console.log("");
    console.log("  Next: Start a Claude Code session — memory auto-loads.");
    console.log('  Tip: Run `pmr status` to inspect your project memory anytime.');
  }
  console.log("");
}
