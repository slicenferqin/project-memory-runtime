CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  branch TEXT,
  repo_head TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  current_goal TEXT,
  next_action TEXT,
  blocking_reason TEXT,
  hot_claim_ids_json TEXT NOT NULL,
  hot_files_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  packet_hash TEXT NOT NULL,
  hot_file_digests_json TEXT,
  stale_reason TEXT,
  UNIQUE(project_id, session_id, source, packet_hash)
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_project_workspace_created
  ON session_checkpoints(project_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_project_status_created
  ON session_checkpoints(project_id, status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_session_checkpoints_validate_insert
BEFORE INSERT ON session_checkpoints
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN ('active', 'stale')
    THEN RAISE(ABORT, 'invalid session_checkpoint.status')
  END;
  SELECT CASE
    WHEN NEW.source NOT IN ('precompact', 'session_end', 'postcompact', 'stop_failure')
    THEN RAISE(ABORT, 'invalid session_checkpoint.source')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_session_checkpoints_validate_update
BEFORE UPDATE ON session_checkpoints
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN ('active', 'stale')
    THEN RAISE(ABORT, 'invalid session_checkpoint.status')
  END;
  SELECT CASE
    WHEN NEW.source NOT IN ('precompact', 'session_end', 'postcompact', 'stop_failure')
    THEN RAISE(ABORT, 'invalid session_checkpoint.source')
  END;
END;
