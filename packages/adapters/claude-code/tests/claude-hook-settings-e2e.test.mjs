import { mkdtempSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runGit(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const MANAGED_MARKER = "# project-memory-runtime-managed-claude-hook";

function invokeCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    ...options,
  });
}

function invokeManagedHook(command, envelope, workdir, env = {}) {
  return spawnSync("sh", ["-lc", command], {
    cwd: workdir,
    env: {
      ...process.env,
      ...env,
    },
    input: JSON.stringify(envelope),
    encoding: "utf8",
  });
}

function findManagedHookCommand(settings, eventName) {
  const eventEntries = Array.isArray(settings.hooks?.[eventName]) ? settings.hooks[eventName] : [];
  for (const entry of eventEntries) {
    const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    for (const hook of hooks) {
      if (typeof hook?.command === "string" && hook.command.includes(MANAGED_MARKER)) {
        return hook.command;
      }
    }
  }
  throw new Error(`missing managed hook command for ${eventName}`);
}

test("install-settings writes idempotent Claude hook config and generated commands work across independent invocations", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-hook-settings-"));
  const repoPath = path.join(tempRoot, "repo");
  const settingsPath = path.join(repoPath, ".claude", "settings.local.json");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        permissions: { allow: ["Bash"] },
        hooks: {
          Notification: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo existing-notification-hook",
                  timeout: 5,
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )}\n`
  );

  const hookCommand = `${process.execPath} ${CLI_PATH}`;
  const installArgs = [
    "install-settings",
    "--settings-file",
    settingsPath,
    "--data-dir",
    dataDir,
    "--command",
    hookCommand,
  ];

  const firstInstall = invokeCli(installArgs, { cwd: repoPath });
  assert.equal(firstInstall.status, 0);

  const secondInstall = invokeCli(installArgs, { cwd: repoPath });
  assert.equal(secondInstall.status, 0);

  const validateInstalled = invokeCli(
    ["validate-settings", "--settings-file", settingsPath],
    { cwd: repoPath }
  );
  assert.equal(validateInstalled.status, 0);
  const validateInstalledOutput = JSON.parse(validateInstalled.stdout.trim());
  assert.equal(validateInstalledOutput.is_valid, true);

  const installedSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(
    installedSettings.hooks.Notification[0].hooks[0].command,
    "echo existing-notification-hook"
  );
  assert.equal(
    installedSettings.hooks.SessionStart
      .flatMap((entry) => entry.hooks)
      .filter((hook) => hook.command.includes(MANAGED_MARKER)).length,
    1
  );

  const sessionStartCommand = findManagedHookCommand(installedSettings, "SessionStart");
  const postToolUseFailureCommand = findManagedHookCommand(
    installedSettings,
    "PostToolUseFailure"
  );

  const sharedEnv = {
    CLAUDE_PROJECT_DIR: repoPath,
  };

  const sessionStartEnvelope = {
    hook_event_name: "SessionStart",
    session_id: "session-installed-settings",
    cwd: repoPath,
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    source: "startup",
    model: "claude-sonnet-4.6",
  };
  const firstSessionStart = invokeManagedHook(
    sessionStartCommand,
    sessionStartEnvelope,
    repoPath,
    sharedEnv
  );
  assert.equal(firstSessionStart.status, 0);
  assert.equal(firstSessionStart.stdout.trim(), "");

  const failingToolEnvelope = {
    hook_event_name: "PostToolUseFailure",
    session_id: "session-installed-settings",
    cwd: repoPath,
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    tool_name: "Bash",
    tool_input: {
      command: "pnpm test",
      cwd: repoPath,
      branch: "main",
    },
    error: "Command exited with non-zero status code 1. Test failed: Windows install path normalizer",
    model: "claude-sonnet-4.6",
  };
  const postToolUseFailure = invokeManagedHook(
    postToolUseFailureCommand,
    failingToolEnvelope,
    repoPath,
    sharedEnv
  );
  assert.equal(postToolUseFailure.status, 0);
  assert.equal(postToolUseFailure.stdout.trim(), "");

  const secondSessionStart = invokeManagedHook(
    sessionStartCommand,
    sessionStartEnvelope,
    repoPath,
    sharedEnv
  );
  assert.equal(secondSessionStart.status, 0);
  const secondOutput = JSON.parse(secondSessionStart.stdout.trim());
  assert.equal(secondOutput.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(secondOutput.hookSpecificOutput.additionalContext, /Windows install path normalizer/);

  const thirdSessionStart = invokeManagedHook(
    sessionStartCommand,
    sessionStartEnvelope,
    repoPath,
    sharedEnv
  );
  assert.equal(thirdSessionStart.status, 0);
  assert.equal(thirdSessionStart.stdout.trim(), "");
});

test("validate-settings fails when a managed Claude hook event is missing", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-hook-validate-"));
  const repoPath = path.join(tempRoot, "repo");
  const settingsPath = path.join(repoPath, ".claude", "settings.local.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "startup|resume|clear|compact",
              hooks: [
                {
                  type: "command",
                  command: `node cli.js ${MANAGED_MARKER}`,
                  timeout: 10,
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )}\n`
  );

  const result = invokeCli(["validate-settings", "--settings-file", settingsPath], {
    cwd: repoPath,
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.is_valid, false);
  assert.ok(output.missing_events.includes("PostToolUse"));
  assert.ok(output.missing_events.includes("SessionEnd"));
});

test("default managed command uses node CLI path instead of pnpm exec bin lookup", async () => {
  const result = invokeCli(["print-settings"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  });

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout.trim());
  const managedCommand = output.hooks.SessionStart[0].hooks[0].command;
  assert.match(managedCommand, /node \.\/packages\/adapters\/claude-code\/dist\/cli\.js/);
  assert.ok(!managedCommand.includes("pnpm exec project-memory-claude-hook"));
});
