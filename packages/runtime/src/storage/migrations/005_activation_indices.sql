-- Performance indices for claim activation queries
CREATE INDEX IF NOT EXISTS idx_claims_project_status
  ON claims (project_id, status);

CREATE INDEX IF NOT EXISTS idx_claims_project_key_status
  ON claims (project_id, canonical_key, cardinality, status);

CREATE INDEX IF NOT EXISTS idx_outcomes_project
  ON claim_outcomes (project_id, ts);

CREATE INDEX IF NOT EXISTS idx_transitions_project_claim
  ON claim_transitions (project_id, claim_id, ts);

CREATE INDEX IF NOT EXISTS idx_events_project_ts
  ON ledger_events (project_id, ts);
