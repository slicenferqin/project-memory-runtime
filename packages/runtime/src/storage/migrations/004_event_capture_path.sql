ALTER TABLE ledger_events ADD COLUMN capture_path TEXT;

CREATE TRIGGER IF NOT EXISTS trg_ledger_events_validate_capture_path_insert
BEFORE INSERT ON ledger_events
BEGIN
  SELECT CASE
    WHEN NEW.capture_path IS NOT NULL
      AND NEW.capture_path NOT IN (
        'fixture.user_confirmation',
        'fixture.user_message',
        'claude_code.hook.user_confirmation',
        'claude_code.hook.user_message',
        'import.transcript',
        'system.tool_observation',
        'operator.manual'
      )
    THEN RAISE(ABORT, 'invalid event.capture_path')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_events_validate_capture_path_update
BEFORE UPDATE ON ledger_events
BEGIN
  SELECT CASE
    WHEN NEW.capture_path IS NOT NULL
      AND NEW.capture_path NOT IN (
        'fixture.user_confirmation',
        'fixture.user_message',
        'claude_code.hook.user_confirmation',
        'claude_code.hook.user_message',
        'import.transcript',
        'system.tool_observation',
        'operator.manual'
      )
    THEN RAISE(ABORT, 'invalid event.capture_path')
  END;
END;
