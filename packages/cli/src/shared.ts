import path from "node:path";
import process from "node:process";
import { ProjectMemoryRuntime } from "@slicenfer/project-memory-runtime-core";
import {
  resolveRuntimeLocation,
  type ResolvedRuntimeLocation,
} from "@slicenfer/project-memory-adapter-claude-code";

export type CliOptions = Record<string, string | boolean | string[]>;

export function resolveRuntimeContext(options: CliOptions): ResolvedRuntimeLocation {
  return resolveRuntimeLocation({
    cwd: process.cwd(),
    dataDir: typeof options["data-dir"] === "string" ? options["data-dir"] : undefined,
    dbPath: typeof options["db-path"] === "string" ? options["db-path"] : undefined,
    project_id: typeof options["project-id"] === "string" ? options["project-id"] : undefined,
    repo_id: typeof options["repo-id"] === "string" ? options["repo-id"] : undefined,
    workspace_id: typeof options["workspace-id"] === "string" ? options["workspace-id"] : undefined,
    branch: typeof options.branch === "string" ? options.branch : undefined,
  });
}

export function resolveProjectId(options: CliOptions): string {
  const location = resolveRuntimeContext(options);
  if (!location.project_id) {
    throw new Error("unable to resolve project_id for current workspace");
  }
  return location.project_id;
}

export function resolveDataDir(options: CliOptions): string {
  const location = resolveRuntimeContext(options);
  if (!location.dataDir) {
    throw new Error("unable to resolve data directory for current workspace");
  }
  return path.resolve(location.dataDir);
}

export function resolveWorkspaceId(options: CliOptions): string {
  const location = resolveRuntimeContext(options);
  if (!location.workspace_id) {
    throw new Error("unable to resolve workspace_id for current workspace");
  }
  return location.workspace_id;
}

export function createRuntime(options: CliOptions): ProjectMemoryRuntime {
  const location = resolveRuntimeContext(options);
  if (!location.enabled || !location.dataDir || !location.dbPath) {
    const reason = location.reason ?? "project memory is disabled for this repository";
    throw new Error(reason);
  }
  return new ProjectMemoryRuntime({
    dataDir: path.resolve(location.dataDir),
    dbPath: path.resolve(location.dbPath),
  });
}

export function runtimeDisabledMessage(options: CliOptions): string | undefined {
  const location = resolveRuntimeContext(options);
  if (location.enabled) return undefined;
  return location.reason ?? "project memory is disabled for this repository";
}

export function isJson(options: CliOptions): boolean {
  return Boolean(options.json);
}

export function formatClaimLine(claim: {
  canonical_key: string;
  content: string;
  type: string;
  status: string;
  confidence: number;
  outcome_score: number;
  verification_status: string;
  outcome_summary?: {
    positive_count: number;
    negative_count: number;
    outcome_types: string[];
    last_outcome_at?: string;
  };
}): string {
  const badge = claim.status === "active" ? "●" : "○";
  const conf = `${Math.round(claim.confidence * 100)}%`;
  const score = claim.outcome_score >= 0 ? `+${claim.outcome_score.toFixed(2)}` : claim.outcome_score.toFixed(2);
  const verified = claim.verification_status !== "unverified" ? ` [${claim.verification_status}]` : "";

  let outcomeBadge = "";
  if (claim.outcome_summary) {
    const s = claim.outcome_summary;
    if (s.positive_count > 0 || s.negative_count > 0) {
      const parts: string[] = [];
      if (s.positive_count > 0) parts.push(`${s.positive_count} pass`);
      if (s.negative_count > 0) parts.push(`${s.negative_count} fail`);
      const icon = s.negative_count === 0 ? "✓" : "⚠";
      outcomeBadge = ` ${icon} ${parts.join(", ")}`;
    }
  }

  return `  ${badge} ${claim.canonical_key}: ${truncate(claim.content, 100)}` +
         `\n    type=${claim.type} confidence=${conf} score=${score}${verified}${outcomeBadge}`;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}
