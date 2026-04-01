import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type ActivationLog,
  type Claim,
  type ClaimScope,
  type ClaimTransition,
  type NormalizedEvent,
  type Outcome,
  type RuntimeConfig,
  type RuntimePaths,
  type RuntimeStats,
} from "../types.js";
import { normalizeClaimScope, singletonScopeCompatible } from "../scope.js";
import {
  validateClaimRecord,
  validateEventRecord,
  validateOutcomeRecord,
  assertClaimTransitionAllowed,
} from "../validation.js";
import { loadSqlMigrations } from "./migrations.js";
import { nowIso } from "../utils.js";

/* ────────────────────── Row types for SQLite results ────────────────────── */

interface EventRow {
  id: string;
  ts: string;
  project_id: string;
  session_id: string | null;
  workspace_id: string | null;
  repo_id: string | null;
  parent_event_id: string | null;
  causation_id: string | null;
  agent_id: string;
  agent_version: string;
  event_type: string;
  content: string;
  capture_path: string | null;
  source_kind: string | null;
  trust_level: string | null;
  scope_json: string | null;
  metadata_json: string | null;
  created_at: string;
}

interface ClaimRow {
  id: string;
  created_at: string;
  project_id: string;
  type: string;
  assertion_kind: string;
  canonical_key: string;
  cardinality: string;
  content: string;
  source_event_ids_json: string;
  confidence: number;
  importance: number;
  outcome_score: number;
  verification_status: string;
  verification_method: string | null;
  status: string;
  pinned: number;
  valid_from: string | null;
  valid_to: string | null;
  supersedes_json: string | null;
  last_verified_at: string | null;
  last_activated_at: string | null;
  scope_json: string | null;
  thread_status: string | null;
  resolved_at: string | null;
  resolution_rules_json: string | null;
}

interface OutcomeRow {
  id: string;
  ts: string;
  project_id: string;
  related_event_ids_json: string;
  related_claim_ids_json: string | null;
  outcome_type: string;
  strength: number;
  notes: string | null;
}

interface TransitionRow {
  id: string;
  ts: string;
  project_id: string;
  claim_id: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  trigger_type: string;
  trigger_ref: string | null;
  actor: string;
}

interface ActivationLogRow {
  id: string;
  ts: string;
  project_id: string;
  claim_id: string;
  eligibility_result: string;
  suppression_reason: string | null;
  rank_score: number | null;
  packing_decision: string | null;
  activation_reasons_json: string | null;
}

interface CountRow {
  count: number;
}

interface SupersedeRow {
  project_id: string;
  status: string;
  supersedes_json: string | null;
}

function serializeJson(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

const BUSY_TIMEOUT_MS = 5000;
const BUSY_RETRY_MAX = 5;
const BUSY_RETRY_BASE_DELAY_MS = 50;

/** Shared buffer for Atomics.wait-based synchronous sleep (non-spinning). */
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function withBusyRetry<T>(fn: () => T, maxRetries: number = BUSY_RETRY_MAX): T {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isBusy = message.includes("SQLITE_BUSY") || message.includes("database is locked");
      if (!isBusy || attempt === maxRetries) throw error;

      // Exponential backoff with jitter — non-spinning synchronous sleep
      const delay = BUSY_RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      Atomics.wait(SLEEP_BUFFER, 0, 0, Math.ceil(delay));
    }
  }
  // Unreachable, but satisfies TS
  throw new Error("withBusyRetry: exhausted retries");
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
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
    this.db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }

  close(): void {
    this.db.close();
  }

  transact<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return withBusyRetry(() => tx());
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
    validateEventRecord(event);

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ledger_events (
        id, ts, project_id, session_id, workspace_id, repo_id, parent_event_id, causation_id,
        agent_id, agent_version, event_type, content, capture_path, source_kind, trust_level, scope_json, metadata_json, created_at
      ) VALUES (
        @id, @ts, @project_id, @session_id, @workspace_id, @repo_id, @parent_event_id, @causation_id,
        @agent_id, @agent_version, @event_type, @content, @capture_path, @source_kind, @trust_level, @scope_json, @metadata_json, @created_at
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
      capture_path: nullable(event.capture_path),
      source_kind: nullable(event.source_kind),
      trust_level: nullable(event.trust_level),
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
    const normalizedClaim = this.normalizeClaim(claim);
    validateClaimRecord(normalizedClaim);
    const stmt = this.db.prepare(`
      INSERT INTO claims (
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
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        project_id = excluded.project_id,
        type = excluded.type,
        assertion_kind = excluded.assertion_kind,
        canonical_key = excluded.canonical_key,
        cardinality = excluded.cardinality,
        content = excluded.content,
        source_event_ids_json = excluded.source_event_ids_json,
        confidence = excluded.confidence,
        importance = excluded.importance,
        outcome_score = excluded.outcome_score,
        verification_status = excluded.verification_status,
        verification_method = excluded.verification_method,
        status = excluded.status,
        pinned = excluded.pinned,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        supersedes_json = excluded.supersedes_json,
        last_verified_at = excluded.last_verified_at,
        last_activated_at = excluded.last_activated_at,
        scope_json = excluded.scope_json,
        thread_status = excluded.thread_status,
        resolved_at = excluded.resolved_at,
        resolution_rules_json = excluded.resolution_rules_json
    `);

    this.transact(() => {
      stmt.run({
        id: normalizedClaim.id,
        created_at: normalizedClaim.created_at,
        project_id: normalizedClaim.project_id,
        type: normalizedClaim.type,
        assertion_kind: normalizedClaim.assertion_kind,
        canonical_key: normalizedClaim.canonical_key,
        cardinality: normalizedClaim.cardinality,
        content: normalizedClaim.content,
        source_event_ids_json: serializeJson(normalizedClaim.source_event_ids),
        confidence: normalizedClaim.confidence,
        importance: normalizedClaim.importance,
        outcome_score: normalizedClaim.outcome_score,
        verification_status: normalizedClaim.verification_status,
        verification_method: nullable(normalizedClaim.verification_method),
        status: normalizedClaim.status,
        supersedes_json: serializeJson(normalizedClaim.supersedes),
        scope_json: serializeJson(normalizedClaim.scope),
        resolution_rules_json: serializeJson(normalizedClaim.resolution_rules),
        pinned: normalizedClaim.pinned ? 1 : 0,
        valid_from: nullable(normalizedClaim.valid_from),
        valid_to: nullable(normalizedClaim.valid_to),
        last_verified_at: nullable(normalizedClaim.last_verified_at),
        last_activated_at: nullable(normalizedClaim.last_activated_at),
        thread_status: nullable(normalizedClaim.thread_status),
        resolved_at: nullable(normalizedClaim.resolved_at),
      });

      this.assertActiveSingletonInvariant(normalizedClaim);
    });
  }

  insertOutcome(outcome: Outcome): void {
    this.upsertOutcome(outcome);
  }

  upsertOutcome(outcome: Outcome): void {
    validateOutcomeRecord(outcome);
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
          .all(projectId) as EventRow[])
      : (this.db.prepare("SELECT * FROM ledger_events ORDER BY ts ASC").all() as EventRow[]);

    return rows.map((row) => mapEventRow(row));
  }

  listClaims(projectId?: string): Claim[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claims WHERE project_id = ? ORDER BY created_at ASC")
          .all(projectId) as ClaimRow[])
      : (this.db.prepare("SELECT * FROM claims ORDER BY created_at ASC").all() as ClaimRow[]);

    return rows.map((row) => mapClaimRow(row));
  }

  listOutcomes(projectId?: string): Outcome[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claim_outcomes WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as OutcomeRow[])
      : (this.db.prepare("SELECT * FROM claim_outcomes ORDER BY ts ASC").all() as OutcomeRow[]);

    return rows.map((row) => mapOutcomeRow(row));
  }

  getClaimById(claimId: string): Claim | undefined {
    const row = this.db.prepare("SELECT * FROM claims WHERE id = ?").get(claimId) as ClaimRow | undefined;
    if (!row) return undefined;
    return mapClaimRow(row);
  }

  findCompatibleActiveSingletonClaims(
    projectId: string,
    canonicalKey: string,
    scope: ClaimScope | undefined,
    excludeClaimId?: string
  ): Claim[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM claims
        WHERE project_id = ?
          AND canonical_key = ?
          AND cardinality = 'singleton'
          AND status = 'active'
        ORDER BY created_at ASC
      `)
      .all(projectId, canonicalKey) as ClaimRow[];

    return rows
      .map((row) => mapClaimRow(row))
      .filter(
        (claim) =>
          claim.id !== excludeClaimId && singletonScopeCompatible(claim.scope, scope)
      );
  }

  supersedeClaim(oldClaimId: string, newClaimId: string, reason: string, triggerType: string, actor: string): void {
    const existing = this.db
      .prepare("SELECT project_id, status, supersedes_json FROM claims WHERE id = ?")
      .get(oldClaimId) as SupersedeRow | undefined;

    if (!existing) return;
    assertClaimTransitionAllowed(
      existing.status as Claim["status"],
      "superseded",
      "supersede_claim"
    );

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

  insertActivationLog(log: ActivationLog): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO activation_logs (
        id, ts, project_id, claim_id, eligibility_result, suppression_reason, rank_score, packing_decision, activation_reasons_json
      ) VALUES (
        @id, @ts, @project_id, @claim_id, @eligibility_result, @suppression_reason, @rank_score, @packing_decision, @activation_reasons_json
      )
    `);

    stmt.run({
      ...log,
      suppression_reason: nullable(log.suppression_reason),
      rank_score: log.rank_score ?? null,
      packing_decision: nullable(log.packing_decision),
      activation_reasons_json: serializeJson(log.activation_reasons),
    });
  }

  listActivationLogs(projectId?: string): ActivationLog[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM activation_logs WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as ActivationLogRow[])
      : (this.db.prepare("SELECT * FROM activation_logs ORDER BY ts ASC").all() as ActivationLogRow[]);

    return rows.map((row) => mapActivationLogRow(row));
  }

  listClaimTransitions(projectId?: string): ClaimTransition[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM claim_transitions WHERE project_id = ? ORDER BY ts ASC")
          .all(projectId) as TransitionRow[])
      : (this.db.prepare("SELECT * FROM claim_transitions ORDER BY ts ASC").all() as TransitionRow[]);

    return rows.map((row) => mapTransitionRow(row));
  }

  getStats(): RuntimeStats {
    const count = (table: string): number => {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as CountRow;
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

  private normalizeClaim(claim: Claim): Claim {
    return {
      ...claim,
      scope: normalizeClaimScope(claim.scope),
    };
  }

  private assertActiveSingletonInvariant(claim: Claim): void {
    if (claim.cardinality !== "singleton" || claim.status !== "active") return;

    const conflicts = this.findCompatibleActiveSingletonClaims(
      claim.project_id,
      claim.canonical_key,
      claim.scope,
      claim.id
    );
    if (conflicts.length === 0) return;

    throw new Error(
      `active singleton invariant violated for ${claim.project_id}:${claim.canonical_key}`
    );
  }
}

/* ───────────────────── Row mapping functions ───────────────────── */

function mapEventRow(row: EventRow): NormalizedEvent {
  return {
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
    event_type: row.event_type as NormalizedEvent["event_type"],
    content: row.content,
    capture_path: (row.capture_path ?? undefined) as NormalizedEvent["capture_path"],
    source_kind: (row.source_kind ?? undefined) as NormalizedEvent["source_kind"],
    trust_level: (row.trust_level ?? undefined) as NormalizedEvent["trust_level"],
    scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

function mapClaimRow(row: ClaimRow): Claim {
  return {
    id: row.id,
    created_at: row.created_at,
    project_id: row.project_id,
    type: row.type as Claim["type"],
    assertion_kind: row.assertion_kind as Claim["assertion_kind"],
    canonical_key: row.canonical_key,
    cardinality: row.cardinality as Claim["cardinality"],
    content: row.content,
    source_event_ids: JSON.parse(row.source_event_ids_json),
    confidence: row.confidence,
    importance: row.importance,
    outcome_score: row.outcome_score,
    verification_status: row.verification_status as Claim["verification_status"],
    verification_method: row.verification_method ?? undefined,
    status: row.status as Claim["status"],
    pinned: Boolean(row.pinned),
    valid_from: row.valid_from ?? undefined,
    valid_to: row.valid_to ?? undefined,
    supersedes: row.supersedes_json ? JSON.parse(row.supersedes_json) : undefined,
    last_verified_at: row.last_verified_at ?? undefined,
    last_activated_at: row.last_activated_at ?? undefined,
    scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
    thread_status: (row.thread_status ?? undefined) as Claim["thread_status"],
    resolved_at: row.resolved_at ?? undefined,
    resolution_rules: row.resolution_rules_json
      ? JSON.parse(row.resolution_rules_json)
      : undefined,
  };
}

function mapOutcomeRow(row: OutcomeRow): Outcome {
  return {
    id: row.id,
    ts: row.ts,
    project_id: row.project_id,
    related_event_ids: JSON.parse(row.related_event_ids_json),
    related_claim_ids: row.related_claim_ids_json
      ? JSON.parse(row.related_claim_ids_json)
      : undefined,
    outcome_type: row.outcome_type as Outcome["outcome_type"],
    strength: row.strength,
    notes: row.notes ?? undefined,
  };
}

function mapTransitionRow(row: TransitionRow): ClaimTransition {
  return {
    id: row.id,
    ts: row.ts,
    project_id: row.project_id,
    claim_id: row.claim_id,
    from_status: (row.from_status ?? undefined) as ClaimTransition["from_status"],
    to_status: row.to_status as ClaimTransition["to_status"],
    reason: row.reason,
    trigger_type: row.trigger_type,
    trigger_ref: row.trigger_ref ?? undefined,
    actor: row.actor,
  };
}

function mapActivationLogRow(row: ActivationLogRow): ActivationLog {
  return {
    id: row.id,
    ts: row.ts,
    project_id: row.project_id,
    claim_id: row.claim_id,
    eligibility_result: row.eligibility_result as ActivationLog["eligibility_result"],
    suppression_reason: (row.suppression_reason ?? undefined) as ActivationLog["suppression_reason"],
    rank_score: row.rank_score ?? undefined,
    packing_decision: (row.packing_decision ?? undefined) as ActivationLog["packing_decision"],
    activation_reasons: row.activation_reasons_json
      ? JSON.parse(row.activation_reasons_json)
      : undefined,
  };
}
