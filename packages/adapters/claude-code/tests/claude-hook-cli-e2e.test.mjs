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

function invokeCli(workdir, envelope, dataDir) {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--data-dir", dataDir],
    {
      cwd: workdir,
      input: JSON.stringify(envelope),
      encoding: "utf8",
    }
  );

  return result;
}

test("claude hook CLI runs a multi-process SessionStart -> PostToolUseFailure -> SessionStart -> deduped SessionStart flow", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pmr-claude-cli-e2e-"));
  const repoPath = path.join(tempRoot, "repo");
  const dataDir = path.join(tempRoot, ".memory");
  fs.mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ["init", "-b", "main"]);
  runGit(repoPath, ["remote", "add", "origin", "https://github.com/acme/demo.git"]);

  const sessionStartEnvelope = {
    hook_event_name: "SessionStart",
    session_id: "session-cli-1",
    cwd: repoPath,
    transcript_path: path.join(repoPath, ".claude", "transcript.jsonl"),
    source: "startup",
    model: "claude-sonnet-4.6",
  };
  const firstSessionStart = invokeCli(repoPath, sessionStartEnvelope, dataDir);
  assert.equal(firstSessionStart.status, 0);
  assert.equal(firstSessionStart.stdout.trim(), "");

  const postToolUseFailureEnvelope = {
    hook_event_name: "PostToolUseFailure",
    session_id: "session-cli-1",
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
  const postToolUse = invokeCli(repoPath, postToolUseFailureEnvelope, dataDir);
  assert.equal(postToolUse.status, 0);
  assert.equal(postToolUse.stdout.trim(), "");

  const secondSessionStart = invokeCli(repoPath, sessionStartEnvelope, dataDir);
  assert.equal(secondSessionStart.status, 0);
  const secondOutput = JSON.parse(secondSessionStart.stdout.trim());
  assert.equal(secondOutput.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(
    secondOutput.hookSpecificOutput.additionalContext,
    /Windows install path normalizer/
  );

  const thirdSessionStart = invokeCli(repoPath, sessionStartEnvelope, dataDir);
  assert.equal(thirdSessionStart.status, 0);
  assert.equal(thirdSessionStart.stdout.trim(), "");
});
