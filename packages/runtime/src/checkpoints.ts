import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { RecallCheckpoint, SessionCheckpoint } from "./types.js";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(cwd: string | undefined, args: string[]): string | undefined {
  if (!cwd) return undefined;

  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function checkpointPacketHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function currentRepoHead(cwd?: string): string | undefined {
  return runGit(cwd, ["rev-parse", "HEAD"]);
}

export function currentBranch(cwd?: string): string | undefined {
  const branch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return undefined;
  return branch;
}

export function normalizeCheckpointFilePath(cwd: string | undefined, filePath: string): string {
  if (!cwd) return filePath;
  if (path.isAbsolute(filePath)) {
    const relative = path.relative(cwd, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }
  return filePath;
}

export function resolveCheckpointFilePath(cwd: string | undefined, filePath: string): string {
  if (!cwd || path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

export function computeCheckpointFileDigests(
  cwd: string | undefined,
  hotFiles: string[]
): Record<string, string> {
  const digests: Record<string, string> = {};

  for (const filePath of hotFiles) {
    const resolved = resolveCheckpointFilePath(cwd, filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      digests[filePath] = "missing";
      continue;
    }
    digests[filePath] = sha256(fs.readFileSync(resolved));
  }

  return digests;
}

export function verifyCheckpointFileDigests(
  cwd: string | undefined,
  hotFiles: string[],
  expectedDigests: Record<string, string> | undefined
): string[] {
  if (!expectedDigests) return [];

  const changed: string[] = [];
  const actualDigests = computeCheckpointFileDigests(cwd, hotFiles);

  for (const filePath of hotFiles) {
    if (actualDigests[filePath] !== expectedDigests[filePath]) {
      changed.push(filePath);
    }
  }

  return changed;
}

export function toRecallCheckpoint(
  checkpoint: SessionCheckpoint,
  options: { hideNextAction?: boolean } = {}
): RecallCheckpoint {
  return {
    id: checkpoint.id,
    created_at: checkpoint.created_at,
    project_id: checkpoint.project_id,
    session_id: checkpoint.session_id,
    workspace_id: checkpoint.workspace_id,
    branch: checkpoint.branch,
    repo_head: checkpoint.repo_head,
    status: checkpoint.status,
    source: checkpoint.source,
    summary: checkpoint.summary,
    current_goal: checkpoint.current_goal,
    next_action: options.hideNextAction ? undefined : checkpoint.next_action,
    blocking_reason: checkpoint.blocking_reason,
    hot_claim_ids: [...checkpoint.hot_claim_ids],
    hot_files: [...checkpoint.hot_files],
    evidence_refs: [...checkpoint.evidence_refs],
    stale_reason: checkpoint.stale_reason,
  };
}
