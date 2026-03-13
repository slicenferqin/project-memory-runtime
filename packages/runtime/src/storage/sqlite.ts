import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type Claim,
  type ClaimTransition,
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
    this.insertEventWithResult(event);
  }

  insertEventWithResult(event: NormalizedEvent): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ledger_events (
        id, ts, project_id, session_id, workspace_id, repo_id, parent_event_id, causation_id,
        agent_id, agent_version, event_type, content, scope_json, metadata_json, created_at
      ) VALUES (
        @id, @ts, @project_id, @session_id, @workspace_id, @repo_id, @parent_event_id, @causation_id,
        @agent_id, @agent_version, @event_type, @content, @scope_json, @metadata_json, @created_at
      )
    `);

    const result = stmt.run({
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

    return result.changes > 0;
  }

  insertClaim(claim: Claim): void {
    this.upsertClaim(claim);
  }

  upsertClaim(claim: Claim): void {
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
    this.upsertOutcome(outcome);
  }

  upsertOutcome(outcome: Outcome): void {
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

  listEvents(projectId?: string): NormalizedEvent[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM ledger_events WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as any[])
      : (this.db.prepare("SELECT * FROM ledger_events ORDER BY ts ASC").all() as any[]);

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      project_id: row.project_id,
      session_id: row.session_id ?? undefined,
      workspace_id: row.workspace_id ?? undefined,
      repo_id: row.repo_id ?? undefined,
      parent_event_id: row.parent_event_id ?? undefined,
      causation_id: row.causation_id ?? undefined,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      event_type: row.event_type,
      content: row.content,
      scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  listClaims(projectId?: string): Claim[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claims WHERE project_id = ? ORDER BY created_at ASC")
          .all(projectId) as any[])
      : (this.db.prepare("SELECT * FROM claims ORDER BY created_at ASC").all() as any[]);

    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      project_id: row.project_id,
      type: row.type,
      assertion_kind: row.assertion_kind,
      canonical_key: row.canonical_key,
      cardinality: row.cardinality,
      content: row.content,
      source_event_ids: JSON.parse(row.source_event_ids_json),
      confidence: row.confidence,
      importance: row.importance,
      outcome_score: row.outcome_score,
      verification_status: row.verification_status,
      verification_method: row.verification_method ?? undefined,
      status: row.status,
      pinned: Boolean(row.pinned),
      valid_from: row.valid_from ?? undefined,
      valid_to: row.valid_to ?? undefined,
      supersedes: row.supersedes_json ? JSON.parse(row.supersedes_json) : undefined,
      last_verified_at: row.last_verified_at ?? undefined,
      last_activated_at: row.last_activated_at ?? undefined,
      scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
      thread_status: row.thread_status ?? undefined,
      resolved_at: row.resolved_at ?? undefined,
      resolution_rules: row.resolution_rules_json
        ? JSON.parse(row.resolution_rules_json)
        : undefined,
    }));
  }

  listOutcomes(projectId?: string): Outcome[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claim_outcomes WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as any[])
      : (this.db.prepare("SELECT * FROM claim_outcomes ORDER BY ts ASC").all() as any[]);

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      project_id: row.project_id,
      related_event_ids: JSON.parse(row.related_event_ids_json),
      related_claim_ids: row.related_claim_ids_json
        ? JSON.parse(row.related_claim_ids_json)
        : undefined,
      outcome_type: row.outcome_type,
      strength: row.strength,
      notes: row.notes ?? undefined,
    }));
  }

  getClaimById(claimId: string): Claim | undefined {
    const row = this.db.prepare("SELECT * FROM claims WHERE id = ?").get(claimId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      created_at: row.created_at,
      project_id: row.project_id,
      type: row.type,
      assertion_kind: row.assertion_kind,
      canonical_key: row.canonical_key,
      cardinality: row.cardinality,
      content: row.content,
      source_event_ids: JSON.parse(row.source_event_ids_json),
      confidence: row.confidence,
      importance: row.importance,
      outcome_score: row.outcome_score,
      verification_status: row.verification_status,
      verification_method: row.verification_method ?? undefined,
      status: row.status,
      pinned: Boolean(row.pinned),
      valid_from: row.valid_from ?? undefined,
      valid_to: row.valid_to ?? undefined,
      supersedes: row.supersedes_json ? JSON.parse(row.supersedes_json) : undefined,
      last_verified_at: row.last_verified_at ?? undefined,
      last_activated_at: row.last_activated_at ?? undefined,
      scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
      thread_status: row.thread_status ?? undefined,
      resolved_at: row.resolved_at ?? undefined,
      resolution_rules: row.resolution_rules_json
        ? JSON.parse(row.resolution_rules_json)
        : undefined,
    };
  }

  findActiveSingletonClaims(projectId: string, canonicalKey: string, scopeJson: string | null): Claim[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM claims
        WHERE project_id = ?
          AND canonical_key = ?
          AND cardinality = 'singleton'
          AND status = 'active'
          AND (
            (scope_json IS NULL AND ? IS NULL)
            OR scope_json = ?
          )
        ORDER BY created_at ASC
      `)
      .all(projectId, canonicalKey, scopeJson, scopeJson) as any[];

    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      project_id: row.project_id,
      type: row.type,
      assertion_kind: row.assertion_kind,
      canonical_key: row.canonical_key,
      cardinality: row.cardinality,
      content: row.content,
      source_event_ids: JSON.parse(row.source_event_ids_json),
      confidence: row.confidence,
      importance: row.importance,
      outcome_score: row.outcome_score,
      verification_status: row.verification_status,
      verification_method: row.verification_method ?? undefined,
      status: row.status,
      pinned: Boolean(row.pinned),
      valid_from: row.valid_from ?? undefined,
      valid_to: row.valid_to ?? undefined,
      supersedes: row.supersedes_json ? JSON.parse(row.supersedes_json) : undefined,
      last_verified_at: row.last_verified_at ?? undefined,
      last_activated_at: row.last_activated_at ?? undefined,
      scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
      thread_status: row.thread_status ?? undefined,
      resolved_at: row.resolved_at ?? undefined,
      resolution_rules: row.resolution_rules_json
        ? JSON.parse(row.resolution_rules_json)
        : undefined,
    }));
  }

  supersedeClaim(oldClaimId: string, newClaimId: string, reason: string, triggerType: string, actor: string): void {
    const existing = this.db
      .prepare("SELECT project_id, status, supersedes_json FROM claims WHERE id = ?")
      .get(oldClaimId) as
      | { project_id: string; status: string; supersedes_json: string | null }
      | undefined;

    if (!existing) return;

    const supersedes = existing.supersedes_json
      ? (JSON.parse(existing.supersedes_json) as string[])
      : [];
    if (!supersedes.includes(newClaimId)) supersedes.push(newClaimId);

    const updateStmt = this.db.prepare(`
      UPDATE claims
      SET status = 'superseded',
          supersedes_json = ?
      WHERE id = ?
    `);

    updateStmt.run(JSON.stringify(supersedes), oldClaimId);

    const insertTransition = this.db.prepare(`
      INSERT OR REPLACE INTO claim_transitions (
        id, ts, project_id, claim_id, from_status, to_status, reason, trigger_type, trigger_ref, actor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTransition.run(
      `trn-${oldClaimId}-${newClaimId}`,
      nowIso(),
      existing.project_id,
      oldClaimId,
      existing.status,
      "superseded",
      reason,
      triggerType,
      newClaimId,
      actor
    );
  }

  insertClaimTransition(transition: ClaimTransition): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO claim_transitions (
        id, ts, project_id, claim_id, from_status, to_status, reason, trigger_type, trigger_ref, actor
      ) VALUES (
        @id, @ts, @project_id, @claim_id, @from_status, @to_status, @reason, @trigger_type, @trigger_ref, @actor
      )
    `);

    stmt.run({
      ...transition,
      from_status: nullable(transition.from_status),
      trigger_ref: nullable(transition.trigger_ref),
    });
  }

  listClaimTransitions(projectId?: string): ClaimTransition[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claim_transitions WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as any[])
      : (this.db.prepare("SELECT * FROM claim_transitions ORDER BY ts ASC").all() as any[]);

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      project_id: row.project_id,
      claim_id: row.claim_id,
      from_status: row.from_status ?? undefined,
      to_status: row.to_status,
      reason: row.reason,
      trigger_type: row.trigger_type,
      trigger_ref: row.trigger_ref ?? undefined,
      actor: row.actor,
    }));
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
