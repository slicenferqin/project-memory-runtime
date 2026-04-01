import path from "node:path";
import process from "node:process";
import { ProjectMemoryRuntime } from "@slicenferqin/project-memory-runtime-core";
import { defaultClaudeProjectId } from "@slicenferqin/project-memory-adapter-claude-code";

export type CliOptions = Record<string, string | boolean | string[]>;

export function resolveProjectId(options: CliOptions): string {
  const explicit = typeof options["project-id"] === "string" ? options["project-id"] : undefined;
  if (explicit) return explicit;
  return defaultClaudeProjectId(process.cwd());
}

export function resolveDataDir(options: CliOptions): string {
  const explicit = typeof options["data-dir"] === "string" ? options["data-dir"] : undefined;
  return explicit ? path.resolve(explicit) : path.join(process.cwd(), ".memory");
}

export function createRuntime(options: CliOptions): ProjectMemoryRuntime {
  const config: { dataDir?: string; dbPath?: string } = {};
  config.dataDir = resolveDataDir(options);
  if (typeof options["db-path"] === "string") {
    config.dbPath = path.resolve(options["db-path"]);
  }
  return new ProjectMemoryRuntime(config);
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
