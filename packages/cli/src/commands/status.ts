import type { Claim } from "@slicenferqin/project-memory-runtime-core";
import { createRuntime, resolveProjectId, isJson, truncate, type CliOptions } from "../shared.js";

export function runStatus(options: CliOptions): void {
  const runtime = createRuntime(options);
  try {
    const projectId = resolveProjectId(options);
    const stats = runtime.getStats();
    const claims = runtime.listClaims(projectId);

    if (isJson(options)) {
      console.log(JSON.stringify({ project_id: projectId, stats, claim_summary: summarizeClaims(claims) }, null, 2));
      return;
    }

    console.log("Project Memory Status");
    console.log("─".repeat(40));
    console.log(`  Project:     ${projectId}`);
    console.log(`  Database:    ${runtime.getPaths().dbPath}`);
    console.log("");
    console.log("  Records:");
    console.log(`    Events:          ${stats.events}`);
    console.log(`    Claims:          ${stats.claims}`);
    console.log(`    Outcomes:        ${stats.outcomes}`);
    console.log(`    Transitions:     ${stats.transitions}`);
    console.log(`    Activation Logs: ${stats.activationLogs}`);
    console.log(`    Migrations:      ${stats.migrationsApplied}`);

    const summary = summarizeClaims(claims);
    if (claims.length > 0) {
      console.log("");
      console.log("  Claims by type:");
      for (const [type, count] of Object.entries(summary.byType)) {
        console.log(`    ${type}: ${count}`);
      }
      console.log("  Claims by status:");
      for (const [status, count] of Object.entries(summary.byStatus)) {
        console.log(`    ${status}: ${count}`);
      }

      console.log("");
      console.log("  Recent claims:");
      const recent = claims.slice(-5).reverse();
      for (const claim of recent) {
        const badge = claim.status === "active" ? "●" : "○";
        console.log(`    ${badge} ${claim.canonical_key}: ${truncate(claim.content, 60)}`);
      }
    }
  } finally {
    runtime.close();
  }
}

function summarizeClaims(claims: Claim[]): {
  byType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const claim of claims) {
    byType[claim.type] = (byType[claim.type] ?? 0) + 1;
    byStatus[claim.status] = (byStatus[claim.status] ?? 0) + 1;
  }

  return { byType, byStatus };
}
