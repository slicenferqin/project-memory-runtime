import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type Claim,
  type NormalizedEvent,
  type Outcome,
  type RuntimeConfig,
  type RuntimePaths,
  type RuntimeStats,
} from "../types.js";
import { loadSqlMigrations } from "./migrations.js";

function serializeJson(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveRuntimePaths(config: RuntimeConfig = {}): RuntimePaths {
  const dataDir = config.dataDir ?? path.join(process.cwd(), ".memory");
  const dbPath = config.dbPath ?? path.join(dataDir, "runtime.sqlite");
  return { dataDir, dbPath };
}

export class RuntimeStorage {
  readonly paths: RuntimePaths;
  readonly db: Database.Database;

  constructor(config: RuntimeConfig = {}) {
    this.paths = resolveRuntimePaths(config);
    ensureDir(this.paths.dataDir);
    ensureDir(path.dirname(this.paths.dbPath));
    this.db = new Database(this.paths.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  close(): void {
    this.db.close();
  }

  applyMigrations(): number {
    const migrations = loadSqlMigrations();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const hasMigration = this.db.prepare(
      "SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1"
    );
    const insertMigration = this.db.prepare(
      "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
    );

    let applied = 0;

    for (const migration of migrations) {
      const exists = hasMigration.get(migration.id);
      if (exists) continue;

      const tx = this.db.transaction(() => {
        this.db.exec(migration.sql);
        insertMigration.run(migration.id, nowIso());
      });

      tx();
      applied += 1;
    }

    return applied;
  }

  insertEvent(event: NormalizedEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ledger_events (
        id, ts, project_id, session_id, workspace_id, repo_id, parent_event_id, causation_id,
        agent_id, agent_version, event_type, content, scope_json, metadata_json, created_at
      ) VALUES (
        @id, @ts, @project_id, @session_id, @workspace_id, @repo_id, @parent_event_id, @causation_id,
        @agent_id, @agent_version, @event_type, @content, @scope_json, @metadata_json, @created_at
      )
    `);

    stmt.run({
      id: event.id,
      ts: event.ts,
      project_id: event.project_id,
      session_id: nullable(event.session_id),
      workspace_id: nullable(event.workspace_id),
      repo_id: nullable(event.repo_id),
      parent_event_id: nullable(event.parent_event_id),
      causation_id: nullable(event.causation_id),
      agent_id: event.agent_id,
      agent_version: event.agent_version,
      event_type: event.event_type,
      content: event.content,
      scope_json: serializeJson(event.scope),
      metadata_json: serializeJson(event.metadata),
      created_at: nowIso(),
    });
  }

  insertClaim(claim: Claim): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO claims (
        id, created_at, project_id, type, assertion_kind, canonical_key, cardinality, content,
        source_event_ids_json, confidence, importance, outcome_score, verification_status,
        verification_method, status, pinned, valid_from, valid_to, supersedes_json,
        last_verified_at, last_activated_at, scope_json, thread_status, resolved_at, resolution_rules_json
      ) VALUES (
        @id, @created_at, @project_id, @type, @assertion_kind, @canonical_key, @cardinality, @content,
        @source_event_ids_json, @confidence, @importance, @outcome_score, @verification_status,
        @verification_method, @status, @pinned, @valid_from, @valid_to, @supersedes_json,
        @last_verified_at, @last_activated_at, @scope_json, @thread_status, @resolved_at, @resolution_rules_json
      )
    `);

    stmt.run({
      id: claim.id,
      created_at: claim.created_at,
      project_id: claim.project_id,
      type: claim.type,
      assertion_kind: claim.assertion_kind,
      canonical_key: claim.canonical_key,
      cardinality: claim.cardinality,
      content: claim.content,
      source_event_ids_json: serializeJson(claim.source_event_ids),
      confidence: claim.confidence,
      importance: claim.importance,
      outcome_score: claim.outcome_score,
      verification_status: claim.verification_status,
      verification_method: nullable(claim.verification_method),
      status: claim.status,
      supersedes_json: serializeJson(claim.supersedes),
      scope_json: serializeJson(claim.scope),
      resolution_rules_json: serializeJson(claim.resolution_rules),
      pinned: claim.pinned ? 1 : 0,
      valid_from: nullable(claim.valid_from),
      valid_to: nullable(claim.valid_to),
      last_verified_at: nullable(claim.last_verified_at),
      last_activated_at: nullable(claim.last_activated_at),
      thread_status: nullable(claim.thread_status),
      resolved_at: nullable(claim.resolved_at),
    });
  }

  insertOutcome(outcome: Outcome): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO claim_outcomes (
        id, ts, project_id, related_event_ids_json, related_claim_ids_json, outcome_type, strength, notes
      ) VALUES (
        @id, @ts, @project_id, @related_event_ids_json, @related_claim_ids_json, @outcome_type, @strength, @notes
      )
    `);

    stmt.run({
      id: outcome.id,
      ts: outcome.ts,
      project_id: outcome.project_id,
      related_event_ids_json: serializeJson(outcome.related_event_ids),
      related_claim_ids_json: serializeJson(outcome.related_claim_ids),
      outcome_type: outcome.outcome_type,
      strength: outcome.strength,
      notes: nullable(outcome.notes),
    });
  }

  getStats(): RuntimeStats {
    const count = (table: string): number => {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
        count: number;
      };
      return row.count;
    };

    return {
      events: count("ledger_events"),
      claims: count("claims"),
      outcomes: count("claim_outcomes"),
      transitions: count("claim_transitions"),
      activationLogs: count("activation_logs"),
      migrationsApplied: count("schema_migrations"),
    };
  }
}
