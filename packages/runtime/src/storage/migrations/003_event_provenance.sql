ALTER TABLE ledger_events ADD COLUMN source_kind TEXT;
ALTER TABLE ledger_events ADD COLUMN trust_level TEXT;

CREATE TRIGGER IF NOT EXISTS trg_ledger_events_validate_insert
BEFORE INSERT ON ledger_events
BEGIN
  SELECT CASE
    WHEN NEW.event_type NOT IN ('user_message', 'agent_message', 'file_edit', 'command_result', 'test_result', 'build_result', 'lint_result', 'benchmark_result', 'deploy_result', 'git_commit', 'git_revert', 'pr_opened', 'pr_merged', 'pr_closed', 'issue_link', 'issue_closed', 'issue_reopened', 'human_edit_after_agent', 'manual_override', 'session_start', 'session_end', 'user_confirmation')
    THEN RAISE(ABORT, 'invalid event.event_type')
  END;
  SELECT CASE
    WHEN NEW.source_kind IS NOT NULL AND NEW.source_kind NOT IN ('user', 'agent', 'system', 'operator', 'imported')
    THEN RAISE(ABORT, 'invalid event.source_kind')
  END;
  SELECT CASE
    WHEN NEW.trust_level IS NOT NULL AND NEW.trust_level NOT IN ('low', 'medium', 'high')
    THEN RAISE(ABORT, 'invalid event.trust_level')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_events_validate_update
BEFORE UPDATE ON ledger_events
BEGIN
  SELECT CASE
    WHEN NEW.event_type NOT IN ('user_message', 'agent_message', 'file_edit', 'command_result', 'test_result', 'build_result', 'lint_result', 'benchmark_result', 'deploy_result', 'git_commit', 'git_revert', 'pr_opened', 'pr_merged', 'pr_closed', 'issue_link', 'issue_closed', 'issue_reopened', 'human_edit_after_agent', 'manual_override', 'session_start', 'session_end', 'user_confirmation')
    THEN RAISE(ABORT, 'invalid event.event_type')
  END;
  SELECT CASE
    WHEN NEW.source_kind IS NOT NULL AND NEW.source_kind NOT IN ('user', 'agent', 'system', 'operator', 'imported')
    THEN RAISE(ABORT, 'invalid event.source_kind')
  END;
  SELECT CASE
    WHEN NEW.trust_level IS NOT NULL AND NEW.trust_level NOT IN ('low', 'medium', 'high')
    THEN RAISE(ABORT, 'invalid event.trust_level')
  END;
END;
