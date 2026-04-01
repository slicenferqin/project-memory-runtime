import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pmr-cli-init-"));
}

function runCli(args, cwd) {
  return execFileSync("node", [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
}

function initGitRepo(dir) {
  execSync("git init && git config user.email test@test.com && git config user.name Test", {
    cwd: dir,
    encoding: "utf8",
    stdio: "ignore",
  });
}

test("pmr init creates database, hooks, and skill in a fresh git repo", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);

    const output = runCli(["init"], tmp);

    // Verify output mentions success
    assert.ok(output.includes("✓"), "output should show success markers");
    assert.ok(output.includes("Database"), "output should mention Database");
    assert.ok(output.includes("Hooks"), "output should mention Hooks");
    assert.ok(output.includes("Skill"), "output should mention Skill");
    assert.ok(output.includes("Validation"), "output should mention Validation");

    // Verify database was created
    const dbPath = path.join(tmp, ".memory", "runtime.sqlite");
    assert.ok(fs.existsSync(dbPath), "runtime.sqlite should exist");

    // Verify hooks settings were written
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    assert.ok(fs.existsSync(settingsPath), "settings.local.json should exist");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.ok(settings.hooks, "settings should contain hooks");
    assert.ok(settings.hooks.SessionStart, "should have SessionStart hook");
    assert.ok(settings.hooks.PostToolUse, "should have PostToolUse hook");
    assert.ok(settings.hooks.Stop, "should have Stop hook");

    // Verify skill was installed
    const skillPath = path.join(tmp, ".claude", "skills", "project-memory", "SKILL.md");
    assert.ok(fs.existsSync(skillPath), "SKILL.md should exist");
    const skillContent = fs.readFileSync(skillPath, "utf8");
    assert.ok(skillContent.includes("project-memory"), "skill should reference project-memory");
    assert.ok(skillContent.includes("pmr search"), "skill should mention pmr search");

    // Verify .gitignore was updated
    const gitignorePath = path.join(tmp, ".gitignore");
    assert.ok(fs.existsSync(gitignorePath), ".gitignore should exist");
    const gitignore = fs.readFileSync(gitignorePath, "utf8");
    assert.ok(gitignore.includes(".memory"), ".gitignore should include .memory");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr init is idempotent (running twice does not break)", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);

    // Run init twice
    runCli(["init"], tmp);
    const output2 = runCli(["init"], tmp);

    assert.ok(output2.includes("✓"), "second init should also succeed");
    assert.ok(output2.includes("Validation"), "second init should pass validation");

    // Verify settings still valid (not duplicated hooks)
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Each event should have exactly 1 managed hook
    for (const eventName of ["SessionStart", "PostToolUse", "Stop", "SessionEnd", "PreCompact"]) {
      const entries = settings.hooks[eventName] ?? [];
      const managedCount = entries
        .flatMap((e) => e.hooks ?? [])
        .filter((h) => h.command?.includes("project-memory-runtime-managed-claude-hook"))
        .length;
      assert.equal(managedCount, 1, `${eventName} should have exactly 1 managed hook, got ${managedCount}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr status works on initialized project", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    runCli(["init"], tmp);

    const output = runCli(["status", "--data-dir", path.join(tmp, ".memory")], tmp);
    assert.ok(output.includes("Project Memory Status"), "should show status header");
    assert.ok(output.includes("Events:"), "should show events count");
    assert.ok(output.includes("Claims:"), "should show claims count");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr snapshot works on empty initialized project", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    runCli(["init"], tmp);

    const output = runCli(["snapshot", "--data-dir", path.join(tmp, ".memory")], tmp);
    assert.ok(output.includes("Project Memory Snapshot"), "should show snapshot header");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr search returns results after recording events", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    runCli(["init"], tmp);

    // Use the runtime directly to insert a test event via adapter
    const adapterPath = path.resolve(import.meta.dirname, "../../adapters/claude-code/dist/index.js");
    const dataDir = path.join(tmp, ".memory").replace(/\\/g, "/");
    const setupScript = `
      import { createClaudeCodeRuntime } from "${adapterPath.replace(/\\/g, "/")}";
      const rt = createClaudeCodeRuntime({ dataDir: "${dataDir}", enable_claude_hook_capture_paths: true });
      rt.initialize();
      rt.recordEvent({
        id: "evt-test-search-1",
        ts: new Date().toISOString(),
        project_id: "test-project",
        agent_id: "test",
        agent_version: "1.0",
        event_type: "user_confirmation",
        content: "Use SQLite as the database backend",
        capture_path: "claude_code.hook.user_confirmation",
        metadata: {
          decision_content: "Use SQLite as the database backend",
        },
      });
      rt.close();
    `;
    execFileSync("node", ["--input-type=module", "-e", setupScript], {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    const output = runCli(["search", "SQLite", "--data-dir", path.join(tmp, ".memory"), "--project-id", "test-project"], tmp);
    assert.ok(output.includes("SQLite") || output.includes("sqlite"), "search should find SQLite-related claims");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr --help shows usage information", () => {
  const tmp = makeTempDir();
  try {
    const output = runCli(["--help"], tmp);
    assert.ok(output.includes("Project Memory Runtime"), "should show title");
    assert.ok(output.includes("init"), "should mention init command");
    assert.ok(output.includes("search"), "should mention search command");
    assert.ok(output.includes("explain"), "should mention explain command");
    assert.ok(output.includes("snapshot"), "should mention snapshot command");
    assert.ok(output.includes("status"), "should mention status command");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
