#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { ProjectMemoryRuntime } from "../../packages/runtime/dist/index.js";

const VERIFY_STATUSES = new Set(["system_verified", "user_confirmed", "disputed"]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    if (key === "file") {
      const current = Array.isArray(options[key]) ? options[key] : [];
      current.push(next);
      options[key] = current;
    } else {
      options[key] = next;
    }
    index += 1;
  }

  return { positional, options };
}

function buildScope(options) {
  const files = Array.isArray(options.file)
    ? options.file
    : typeof options.file === "string"
      ? [options.file]
      : [];

  const scope = {};
  if (typeof options.repo === "string" && options.repo) scope.repo = options.repo;
  if (typeof options.branch === "string" && options.branch) scope.branch = options.branch;
  if (typeof options["cwd-prefix"] === "string" && options["cwd-prefix"]) {
    scope.cwd_prefix = options["cwd-prefix"];
  }
  if (files.length > 0) scope.files = files;

  return Object.keys(scope).length > 0 ? scope : undefined;
}

function createRuntime(options) {
  const cwd = typeof options.cwd === "string" ? path.resolve(options.cwd) : process.cwd();
  const config = {};
  if (typeof options["data-dir"] === "string") {
    config.dataDir = path.resolve(cwd, options["data-dir"]);
  }
  if (typeof options["db-path"] === "string") {
    config.dbPath = path.resolve(cwd, options["db-path"]);
  }
  return new ProjectMemoryRuntime(config);
}

function output(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function formatClaims(claims) {
  return claims
    .map(
      (claim) =>
        `${claim.id} [${claim.type}/${claim.status}] ${claim.canonical_key} :: ${claim.content}`
    )
    .join("\n");
}

function formatEvents(events) {
  return events
    .map((event) => `${event.id} [${event.event_type}] ${event.ts} :: ${event.content}`)
    .join("\n");
}

function usage() {
  return [
    "memoryctl commands:",
    "  inspect events --project <project-id> [--limit 20] [--json]",
    "  inspect claims --project <project-id> [--status active] [--limit 20] [--json]",
    "  snapshot --project <project-id> [--agent operator] [--branch <name>] [--json]",
    "  verify <claim-id> --status <system_verified|user_confirmed|disputed> --method <method> [--json]",
    "  explain-claim <claim-id> [--json]",
    "",
    "shared options:",
    "  --data-dir <path>",
    "  --db-path <path>",
    "  --cwd <path>",
  ].join("\n");
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (positional.length === 0 || options.help) {
    output(usage(), false);
    return;
  }

  const runtime = createRuntime(options);
  const asJson = Boolean(options.json);

  try {
    const [command, subcommand] = positional;

    if (command === "inspect" && subcommand === "events") {
      const projectId = typeof options.project === "string" ? options.project : undefined;
      const limit = typeof options.limit === "string" ? Number(options.limit) : undefined;
      let events = runtime.listEvents(projectId);
      if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
        events = events.slice(-limit);
      }
      output(asJson ? events : formatEvents(events), asJson);
      return;
    }

    if (command === "inspect" && subcommand === "claims") {
      const projectId = typeof options.project === "string" ? options.project : undefined;
      const statusFilter = typeof options.status === "string" ? options.status : undefined;
      const limit = typeof options.limit === "string" ? Number(options.limit) : undefined;
      let claims = runtime.listClaims(projectId);
      if (statusFilter) {
        claims = claims.filter((claim) => claim.status === statusFilter);
      }
      if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
        claims = claims.slice(-limit);
      }
      output(asJson ? claims : formatClaims(claims), asJson);
      return;
    }

    if (command === "snapshot") {
      const projectId = typeof options.project === "string" ? options.project : undefined;
      if (!projectId) {
        fail("snapshot requires --project <project-id>");
        return;
      }

      const packet = runtime.buildProjectSnapshot({
        project_id: projectId,
        agent_id: typeof options.agent === "string" ? options.agent : "memoryctl",
        scope: buildScope(options),
      });

      output(asJson ? packet : `${packet.brief}\n\nactive_claims=${packet.active_claims.length} open_threads=${packet.open_threads.length}`, asJson);
      return;
    }

    if (command === "verify") {
      const claimId = subcommand;
      if (!claimId) {
        fail("verify requires <claim-id>");
        return;
      }
      if (typeof options.status !== "string" || typeof options.method !== "string") {
        fail("verify requires --status and --method");
        return;
      }
      if (!VERIFY_STATUSES.has(options.status)) {
        fail(`invalid verify status: ${options.status}`);
        return;
      }

      const claim = runtime.verifyClaim({
        claim_id: claimId,
        status: options.status,
        method: options.method,
      });
      if (!claim) {
        fail(`claim not found: ${claimId}`);
        return;
      }

      output(asJson ? claim : `${claim.id} verified as ${claim.verification_status} via ${claim.verification_method}`, asJson);
      return;
    }

    if (command === "explain-claim") {
      const claimId = subcommand;
      if (!claimId) {
        fail("explain-claim requires <claim-id>");
        return;
      }

      const explanation = runtime.explainClaim(claimId);
      if (!explanation) {
        fail(`claim not found: ${claimId}`);
        return;
      }

      if (asJson) {
        output(explanation, true);
        return;
      }

      const lines = [
        `${explanation.claim.id} ${explanation.claim.canonical_key}`,
        `status=${explanation.claim.status} verification=${explanation.claim.verification_status}`,
        `content=${explanation.claim.content}`,
        `transitions=${explanation.transitions.length}`,
        `activation_logs=${explanation.activation_logs.length}`,
        `related_outcomes=${explanation.related_outcomes.length}`,
      ];
      output(lines.join("\n"), false);
      return;
    }

    if (command === "inspect") {
      fail("inspect requires a subcommand: events | claims");
      return;
    }

    fail(usage());
  } finally {
    runtime.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
