import process from "node:process";
import {
  createRuntime,
  resolveProjectId,
  resolveWorkspaceId,
  isJson,
  formatClaimLine,
  runtimeDisabledMessage,
  type CliOptions,
} from "../shared.js";

export function runSnapshot(options: CliOptions): void {
  const disabledMessage = runtimeDisabledMessage(options);
  if (disabledMessage) {
    console.log(`Project Memory unavailable: ${disabledMessage}`);
    return;
  }

  const runtime = createRuntime(options);
  try {
    const projectId = resolveProjectId(options);

    const packet = runtime.buildProjectSnapshot({
      project_id: projectId,
      agent_id: "pmr-cli",
      workspace_id: resolveWorkspaceId(options),
      cwd: process.cwd(),
    });

    if (isJson(options)) {
      console.log(JSON.stringify(packet, null, 2));
      return;
    }

    console.log("Project Memory Snapshot");
    console.log("═".repeat(50));
    console.log("");

    if (packet.checkpoint) {
      console.log("Continuation Checkpoint:");
      console.log(`  status=${packet.checkpoint.status} source=${packet.checkpoint.source}`);
      console.log(`  summary=${packet.checkpoint.summary}`);
      if (packet.checkpoint.current_goal) {
        console.log(`  current_goal=${packet.checkpoint.current_goal}`);
      }
      if (packet.checkpoint.next_action) {
        console.log(`  next_action=${packet.checkpoint.next_action}`);
      }
      if (packet.checkpoint.blocking_reason) {
        console.log(`  blocking_reason=${packet.checkpoint.blocking_reason}`);
      }
      console.log("");
    }

    if (packet.active_claims.length > 0) {
      console.log(`Active Claims (${packet.active_claims.length}):`);
      for (const claim of packet.active_claims) {
        console.log(formatClaimLine(claim));
      }
      console.log("");
    }

    if (packet.open_threads.length > 0) {
      console.log(`Open Threads (${packet.open_threads.length}):`);
      for (const thread of packet.open_threads) {
        console.log(formatClaimLine(thread));
      }
      console.log("");
    }

    if (packet.warnings?.length) {
      console.log("Warnings:");
      for (const w of packet.warnings) {
        console.log(`  ⚠ ${w}`);
      }
      console.log("");
    }

    if (packet.active_claims.length === 0 && packet.open_threads.length === 0) {
      console.log("No claims in project memory yet.");
      console.log("Start a Claude Code session — memory will be captured automatically.");
    }

    console.log(`\nBrief: ${packet.brief}`);
  } finally {
    runtime.close();
  }
}
