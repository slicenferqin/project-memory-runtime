import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface WorkspaceInfo {
  project_id: string;
  workspace_root: string;
  workspace_type: "git" | "package" | "directory";
}

function hashId(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 24);
}

function findGitRoot(cwd: string): string | null {
  try {
    const result = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function findPackageRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

export function detectWorkspace(cwd: string): WorkspaceInfo {
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    return {
      project_id: hashId("workspace", gitRoot),
      workspace_root: gitRoot,
      workspace_type: "git",
    };
  }

  const packageRoot = findPackageRoot(cwd);
  if (packageRoot) {
    return {
      project_id: hashId("workspace", packageRoot),
      workspace_root: packageRoot,
      workspace_type: "package",
    };
  }

  return {
    project_id: hashId("workspace", cwd),
    workspace_root: cwd,
    workspace_type: "directory",
  };
}
