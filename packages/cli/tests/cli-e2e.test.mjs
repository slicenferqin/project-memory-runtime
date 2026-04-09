import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const ADAPTER_HOOK_ENVELOPE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../adapters/claude-code/dist/hook-envelope.js"
);
const RUNTIME_ENTRY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../runtime/dist/index.js"
);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pmr-cli-init-"));
}

function runCli(args, cwd, env = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
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

test("pmr install-global writes user-level config, hooks, and skill", () => {
  const tmp = makeTempDir();
  const claudeHome = path.join(tmp, "claude-home");
  const env = { PMR_CLAUDE_HOME: claudeHome };

  try {
    const output = runCli(["install-global"], tmp, env);
    assert.ok(output.includes("Hooks"), "output should mention Hooks");
    assert.ok(output.includes("Config"), "output should mention Config");

    const configPath = path.join(claudeHome, "project-memory-runtime", "config.json");
    const settingsPath = path.join(claudeHome, "settings.local.json");
    const skillPath = path.join(claudeHome, "skills", "project-memory", "SKILL.md");

    assert.ok(fs.existsSync(configPath), "global config should exist");
    assert.ok(fs.existsSync(settingsPath), "global settings.local.json should exist");
    assert.ok(fs.existsSync(skillPath), "global skill should exist");

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.mode, "global");

    const validateOutput = runCli(["validate-global"], tmp, env);
    assert.ok(validateOutput.includes("Hooks: ok"), "global validation should pass hooks");
    assert.ok(validateOutput.includes("Skill: ok"), "global validation should pass skill");
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

test("pmr uninstall-global removes user-level hooks, config, and skill but keeps shared data", () => {
  const tmp = makeTempDir();
  const claudeHome = path.join(tmp, "claude-home");
  const env = { PMR_CLAUDE_HOME: claudeHome };

  try {
    runCli(["install-global"], tmp, env);

    const sharedDbPath = path.join(claudeHome, "project-memory-runtime", "data", "runtime.sqlite");
    assert.ok(fs.existsSync(sharedDbPath), "shared runtime DB should exist after install");

    const output = runCli(["uninstall-global"], tmp, env);
    assert.ok(output.includes("Config removed"), "output should mention config removal");

    assert.ok(!fs.existsSync(path.join(claudeHome, "project-memory-runtime", "config.json")));
    assert.ok(!fs.existsSync(path.join(claudeHome, "skills", "project-memory")));
    assert.ok(fs.existsSync(sharedDbPath), "shared runtime DB should be kept on uninstall");

    const settings = JSON.parse(fs.readFileSync(path.join(claudeHome, "settings.local.json"), "utf8"));
    const settingsRaw = JSON.stringify(settings);
    assert.ok(!settingsRaw.includes("project-memory-runtime-managed-claude-hook"));
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
    assert.ok(output.includes("Checkpoints:"), "should show checkpoint count");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr status uses the shared global database for new git repos after install-global", () => {
  const tmp = makeTempDir();
  const repo = path.join(tmp, "repo");
  const claudeHome = path.join(tmp, "claude-home");
  const env = { PMR_CLAUDE_HOME: claudeHome };

  try {
    fs.mkdirSync(repo, { recursive: true });
    initGitRepo(repo);
    execSync("git remote add origin https://github.com/acme/demo.git", {
      cwd: repo,
      encoding: "utf8",
      stdio: "ignore",
    });

    runCli(["install-global"], repo, env);

    const script = `
      import { executeClaudeHookEnvelope } from "${ADAPTER_HOOK_ENVELOPE_PATH.replace(/\\/g, "/")}";
      executeClaudeHookEnvelope({
        hook_event_name: "PostToolUseFailure",
        session_id: "session-global-status",
        cwd: "${repo.replace(/\\/g, "/")}",
        tool_name: "Bash",
        tool_input: { command: "pnpm test", cwd: "${repo.replace(/\\/g, "/")}" },
        error: "Test failed: database migration test",
        model: "claude-sonnet-4.6"
      }, {});
    `;
    execFileSync("node", ["--input-type=module", "-e", script], {
      cwd: repo,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });

    const output = runCli(["status"], repo, env);
    const sharedDbPath = path.join(claudeHome, "project-memory-runtime", "data", "runtime.sqlite");
    assert.ok(output.includes(sharedDbPath), "status should resolve to shared global DB");
    assert.ok(output.includes("Claims:"), "status should show shared DB stats");
    assert.ok(!fs.existsSync(path.join(repo, ".memory", "runtime.sqlite")), "new repo should not create local .memory DB");
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

test("pmr prefers legacy local .memory data over global shared storage", () => {
  const tmp = makeTempDir();
  const repo = path.join(tmp, "repo");
  const claudeHome = path.join(tmp, "claude-home");
  const env = { PMR_CLAUDE_HOME: claudeHome };

  try {
    fs.mkdirSync(repo, { recursive: true });
    initGitRepo(repo);
    execSync("git remote add origin https://github.com/acme/demo.git", {
      cwd: repo,
      encoding: "utf8",
      stdio: "ignore",
    });
    runCli(["install-global"], repo, env);

    const legacyScript = `
      import { ProjectMemoryRuntime } from "${RUNTIME_ENTRY_PATH.replace(/\\/g, "/")}";
      const rt = new ProjectMemoryRuntime({ dataDir: "${path.join(repo, ".memory").replace(/\\/g, "/")}" });
      rt.initialize();
      rt.getAdminApi().insertClaimRecord({
        id: "clm-legacy-local",
        created_at: "2026-03-12T00:00:00.000Z",
        project_id: "github.com/acme/demo",
        type: "decision",
        assertion_kind: "instruction",
        canonical_key: "decision.legacy.local",
        cardinality: "singleton",
        content: "Use legacy local runtime storage",
        source_event_ids: ["evt-legacy-local"],
        confidence: 0.9,
        importance: 0.8,
        outcome_score: 0,
        verification_status: "user_confirmed",
        status: "active"
      });
      rt.close();
    `;
    execFileSync("node", ["--input-type=module", "-e", legacyScript], {
      cwd: repo,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });

    const output = runCli(["search", "legacy", "--project-id", "github.com/acme/demo"], repo, env);
    assert.ok(output.includes("decision.legacy.local"), "search should read from local legacy DB");
    assert.ok(output.includes(path.join(repo, ".memory", "runtime.sqlite")) || fs.existsSync(path.join(repo, ".memory", "runtime.sqlite")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pmr honors repo-local disabled and local override config in global mode", () => {
  const tmp = makeTempDir();
  const repoDisabled = path.join(tmp, "repo-disabled");
  const repoLocal = path.join(tmp, "repo-local");
  const claudeHome = path.join(tmp, "claude-home");
  const env = { PMR_CLAUDE_HOME: claudeHome };

  try {
    fs.mkdirSync(repoDisabled, { recursive: true });
    initGitRepo(repoDisabled);
    execSync("git remote add origin https://github.com/acme/disabled.git", {
      cwd: repoDisabled,
      encoding: "utf8",
      stdio: "ignore",
    });

    fs.mkdirSync(path.join(repoDisabled, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDisabled, ".claude", "project-memory.json"),
      `${JSON.stringify({ mode: "disabled" }, null, 2)}\n`
    );

    runCli(["install-global"], repoDisabled, env);
    const disabledOutput = runCli(["status"], repoDisabled, env);
    assert.ok(disabledOutput.includes("Project Memory unavailable"), "disabled repo should skip project memory");

    fs.mkdirSync(repoLocal, { recursive: true });
    initGitRepo(repoLocal);
    execSync("git remote add origin https://github.com/acme/local.git", {
      cwd: repoLocal,
      encoding: "utf8",
      stdio: "ignore",
    });
    fs.mkdirSync(path.join(repoLocal, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(repoLocal, ".claude", "project-memory.json"),
      `${JSON.stringify({ mode: "local", data_dir: ".pmr-local" }, null, 2)}\n`
    );

    const overrideScript = `
      import { ProjectMemoryRuntime } from "${RUNTIME_ENTRY_PATH.replace(/\\/g, "/")}";
      const rt = new ProjectMemoryRuntime({ dataDir: "${path.join(repoLocal, ".pmr-local").replace(/\\/g, "/")}" });
      rt.initialize();
      rt.getAdminApi().insertClaimRecord({
        id: "clm-local-override",
        created_at: "2026-03-12T00:00:00.000Z",
        project_id: "github.com/acme/local",
        type: "decision",
        assertion_kind: "instruction",
        canonical_key: "decision.local.override",
        cardinality: "singleton",
        content: "Use repo-local override storage",
        source_event_ids: ["evt-local-override"],
        confidence: 0.9,
        importance: 0.8,
        outcome_score: 0,
        verification_status: "user_confirmed",
        status: "active"
      });
      rt.close();
    `;
    execFileSync("node", ["--input-type=module", "-e", overrideScript], {
      cwd: repoLocal,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });

    const localOutput = runCli(["search", "override", "--project-id", "github.com/acme/local"], repoLocal, env);
    assert.ok(localOutput.includes("decision.local.override"), "local override repo should use configured local DB");
    assert.ok(fs.existsSync(path.join(repoLocal, ".pmr-local", "runtime.sqlite")));
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

test("pmr snapshot surfaces the latest continuation checkpoint", () => {
  const tmp = makeTempDir();
  try {
    initGitRepo(tmp);
    runCli(["init"], tmp);

    const adapterPath = path.resolve(import.meta.dirname, "../../adapters/claude-code/dist/index.js");
    const dataDir = path.join(tmp, ".memory").replace(/\\/g, "/");
    const hotFile = path.join(tmp, "src", "auth.ts");
    fs.mkdirSync(path.dirname(hotFile), { recursive: true });
    fs.writeFileSync(hotFile, "export const authMode = 'sqlite';\n");

    const setupScript = `
      import { createClaudeCodeRuntime } from "${adapterPath.replace(/\\/g, "/")}";
      const rt = createClaudeCodeRuntime({ dataDir: "${dataDir}" });
      rt.initialize();
      rt.getAdminApi().insertClaimRecord({
        id: "clm-thread-cli",
        created_at: "2026-03-12T00:00:00.000Z",
        project_id: "github.com/acme/demo",
        type: "thread",
        assertion_kind: "todo",
        canonical_key: "thread.issue.42",
        cardinality: "singleton",
        content: "Refactor auth module",
        source_event_ids: ["evt-thread-cli"],
        confidence: 0.9,
        importance: 0.9,
        outcome_score: 0,
        verification_status: "user_confirmed",
        status: "active",
        thread_status: "open",
        scope: {
          branch: "main",
          cwd_prefix: "${tmp.replace(/\\/g, "/")}",
          files: ["${hotFile.replace(/\\/g, "/")}"],
        },
      });
      rt.recordSessionCheckpoint({
        project_id: "github.com/acme/demo",
        session_id: "session-cli-checkpoint",
        workspace_id: "ws-cli",
        agent_id: "claude-code",
        source: "session_end",
        cwd: "${tmp.replace(/\\/g, "/")}",
        scope: {
          branch: "main",
          cwd_prefix: "${tmp.replace(/\\/g, "/")}",
        },
        summary_hint: "Checkpoint after CLI auth work",
      });
      rt.close();
    `;
    execFileSync("node", ["--input-type=module", "-e", setupScript], {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    const output = runCli(["snapshot", "--data-dir", path.join(tmp, ".memory"), "--project-id", "github.com/acme/demo"], tmp);
    assert.ok(output.includes("Continuation Checkpoint:"), "snapshot should show checkpoint section");
    assert.ok(output.includes("Checkpoint after CLI auth work"), "snapshot should include checkpoint summary");
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
    assert.ok(output.includes("install-global"), "should mention install-global command");
    assert.ok(output.includes("search"), "should mention search command");
    assert.ok(output.includes("explain"), "should mention explain command");
    assert.ok(output.includes("snapshot"), "should mention snapshot command");
    assert.ok(output.includes("status"), "should mention status command");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
