CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT,
  workspace_id TEXT,
  repo_id TEXT,
  parent_event_id TEXT,
  causation_id TEXT,
  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content TEXT NOT NULL,
  scope_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_project_ts
  ON ledger_events(project_id, ts);

CREATE INDEX IF NOT EXISTS idx_ledger_events_project_type_ts
  ON ledger_events(project_id, event_type, ts);

CREATE INDEX IF NOT EXISTS idx_ledger_events_causation
  ON ledger_events(causation_id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  assertion_kind TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  cardinality TEXT NOT NULL,
  content TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  importance REAL NOT NULL,
  outcome_score REAL NOT NULL,
  verification_status TEXT NOT NULL,
  verification_method TEXT,
  status TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_to TEXT,
  supersedes_json TEXT,
  last_verified_at TEXT,
  last_activated_at TEXT,
  scope_json TEXT,
  thread_status TEXT,
  resolved_at TEXT,
  resolution_rules_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_claims_project_key
  ON claims(project_id, canonical_key);

CREATE INDEX IF NOT EXISTS idx_claims_project_status
  ON claims(project_id, status);

CREATE INDEX IF NOT EXISTS idx_claims_project_type_status
  ON claims(project_id, type, status);

CREATE TABLE IF NOT EXISTS claim_outcomes (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  project_id TEXT NOT NULL,
  related_event_ids_json TEXT NOT NULL,
  related_claim_ids_json TEXT,
  outcome_type TEXT NOT NULL,
  strength REAL NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_claim_outcomes_project_ts
  ON claim_outcomes(project_id, ts);

CREATE TABLE IF NOT EXISTS claim_transitions (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  project_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_ref TEXT,
  actor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_transitions_claim_ts
  ON claim_transitions(claim_id, ts);

CREATE TABLE IF NOT EXISTS activation_logs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  project_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  eligibility_result TEXT NOT NULL,
  suppression_reason TEXT,
  rank_score REAL,
  packing_decision TEXT,
  activation_reasons_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_activation_logs_project_ts
  ON activation_logs(project_id, ts);
