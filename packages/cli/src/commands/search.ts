import process from "node:process";
import {
  createRuntime,
  resolveProjectId,
  isJson,
  formatClaimLine,
  runtimeDisabledMessage,
  type CliOptions,
} from "../shared.js";

export function runSearch(positional: string[], options: CliOptions): void {
  const disabledMessage = runtimeDisabledMessage(options);
  if (disabledMessage) {
    console.log(`Project Memory unavailable: ${disabledMessage}`);
    return;
  }

  const query = positional.join(" ").trim();
  if (!query && !options.type && !options.status) {
    console.error("Usage: pmr search \"<query>\" [--type decision|fact|thread] [--status active|stale] [--limit N]");
    process.exitCode = 1;
    return;
  }

  const runtime = createRuntime(options);
  try {
    const projectId = resolveProjectId(options);
    const limit = typeof options.limit === "string" ? Number(options.limit) : undefined;

    const packet = runtime.searchClaims({
      project_id: projectId,
      query: query || "",
      limit: typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
    });

    let results = [...packet.active_claims, ...packet.open_threads];

    // Apply type filter
    if (typeof options.type === "string") {
      results = results.filter((c) => c.type === options.type);
    }

    // Apply status filter
    if (typeof options.status === "string") {
      results = results.filter((c) => c.status === options.status);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log("No matching claims found.");
      if (query) {
        console.log(`\nTip: Try broader terms, or run \`pmr snapshot\` to see all project memory.`);
      }
      return;
    }

    console.log(`Found ${results.length} claim(s):\n`);
    for (const claim of results) {
      console.log(formatClaimLine(claim));
      console.log("");
    }
  } finally {
    runtime.close();
  }
}
