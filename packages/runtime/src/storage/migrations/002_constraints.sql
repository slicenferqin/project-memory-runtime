CREATE TRIGGER IF NOT EXISTS trg_claims_validate_insert
BEFORE INSERT ON claims
BEGIN
  SELECT CASE
    WHEN NEW.type NOT IN ('fact', 'decision', 'thread')
    THEN RAISE(ABORT, 'invalid claim.type')
  END;
  SELECT CASE
    WHEN NEW.assertion_kind NOT IN ('fact', 'hypothesis', 'instruction', 'preference', 'todo', 'outcome')
    THEN RAISE(ABORT, 'invalid claim.assertion_kind')
  END;
  SELECT CASE
    WHEN NEW.cardinality NOT IN ('singleton', 'set')
    THEN RAISE(ABORT, 'invalid claim.cardinality')
  END;
  SELECT CASE
    WHEN NEW.verification_status NOT IN ('unverified', 'inferred', 'user_confirmed', 'system_verified', 'outcome_verified', 'disputed')
    THEN RAISE(ABORT, 'invalid claim.verification_status')
  END;
  SELECT CASE
    WHEN NEW.status NOT IN ('active', 'stale', 'superseded', 'archived')
    THEN RAISE(ABORT, 'invalid claim.status')
  END;
  SELECT CASE
    WHEN NEW.thread_status IS NOT NULL AND NEW.thread_status NOT IN ('open', 'resolved', 'blocked')
    THEN RAISE(ABORT, 'invalid claim.thread_status')
  END;
  SELECT CASE
    WHEN NEW.confidence < 0 OR NEW.confidence > 1
    THEN RAISE(ABORT, 'claim.confidence out of range')
  END;
  SELECT CASE
    WHEN NEW.importance < 0 OR NEW.importance > 1
    THEN RAISE(ABORT, 'claim.importance out of range')
  END;
  SELECT CASE
    WHEN NEW.outcome_score < -1 OR NEW.outcome_score > 1
    THEN RAISE(ABORT, 'claim.outcome_score out of range')
  END;
  SELECT CASE
    WHEN NEW.verification_status = 'disputed' AND NEW.status = 'active'
    THEN RAISE(ABORT, 'disputed claims must not remain active')
  END;
  SELECT CASE
    WHEN NEW.type != 'thread' AND NEW.thread_status IS NOT NULL
    THEN RAISE(ABORT, 'non-thread claims must not set thread_status')
  END;
  SELECT CASE
    WHEN NEW.type != 'thread' AND NEW.resolved_at IS NOT NULL
    THEN RAISE(ABORT, 'non-thread claims must not set resolved_at')
  END;
  SELECT CASE
    WHEN NEW.thread_status = 'resolved' AND NEW.status != 'archived'
    THEN RAISE(ABORT, 'resolved threads must be archived')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_claims_validate_update
BEFORE UPDATE ON claims
BEGIN
  SELECT CASE
    WHEN NEW.type NOT IN ('fact', 'decision', 'thread')
    THEN RAISE(ABORT, 'invalid claim.type')
  END;
  SELECT CASE
    WHEN NEW.assertion_kind NOT IN ('fact', 'hypothesis', 'instruction', 'preference', 'todo', 'outcome')
    THEN RAISE(ABORT, 'invalid claim.assertion_kind')
  END;
  SELECT CASE
    WHEN NEW.cardinality NOT IN ('singleton', 'set')
    THEN RAISE(ABORT, 'invalid claim.cardinality')
  END;
  SELECT CASE
    WHEN NEW.verification_status NOT IN ('unverified', 'inferred', 'user_confirmed', 'system_verified', 'outcome_verified', 'disputed')
    THEN RAISE(ABORT, 'invalid claim.verification_status')
  END;
  SELECT CASE
    WHEN NEW.status NOT IN ('active', 'stale', 'superseded', 'archived')
    THEN RAISE(ABORT, 'invalid claim.status')
  END;
  SELECT CASE
    WHEN NEW.thread_status IS NOT NULL AND NEW.thread_status NOT IN ('open', 'resolved', 'blocked')
    THEN RAISE(ABORT, 'invalid claim.thread_status')
  END;
  SELECT CASE
    WHEN NEW.confidence < 0 OR NEW.confidence > 1
    THEN RAISE(ABORT, 'claim.confidence out of range')
  END;
  SELECT CASE
    WHEN NEW.importance < 0 OR NEW.importance > 1
    THEN RAISE(ABORT, 'claim.importance out of range')
  END;
  SELECT CASE
    WHEN NEW.outcome_score < -1 OR NEW.outcome_score > 1
    THEN RAISE(ABORT, 'claim.outcome_score out of range')
  END;
  SELECT CASE
    WHEN NEW.verification_status = 'disputed' AND NEW.status = 'active'
    THEN RAISE(ABORT, 'disputed claims must not remain active')
  END;
  SELECT CASE
    WHEN NEW.type != 'thread' AND NEW.thread_status IS NOT NULL
    THEN RAISE(ABORT, 'non-thread claims must not set thread_status')
  END;
  SELECT CASE
    WHEN NEW.type != 'thread' AND NEW.resolved_at IS NOT NULL
    THEN RAISE(ABORT, 'non-thread claims must not set resolved_at')
  END;
  SELECT CASE
    WHEN NEW.thread_status = 'resolved' AND NEW.status != 'archived'
    THEN RAISE(ABORT, 'resolved threads must be archived')
  END;
  SELECT CASE
    WHEN OLD.status != NEW.status AND NOT (
      (OLD.status = 'active' AND NEW.status IN ('stale', 'superseded', 'archived')) OR
      (OLD.status = 'stale' AND NEW.status IN ('active', 'superseded', 'archived')) OR
      (OLD.status = 'superseded' AND NEW.status = 'archived') OR
      (OLD.status = 'archived' AND NEW.status = 'active')
    )
    THEN RAISE(ABORT, 'illegal claim status transition')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_claim_outcomes_validate_insert
BEFORE INSERT ON claim_outcomes
BEGIN
  SELECT CASE
    WHEN NEW.outcome_type NOT IN ('test_pass', 'test_fail', 'build_pass', 'build_fail', 'commit_kept', 'commit_reverted', 'issue_closed', 'issue_reopened', 'human_kept', 'human_corrected', 'manual_override')
    THEN RAISE(ABORT, 'invalid outcome.outcome_type')
  END;
  SELECT CASE
    WHEN NEW.strength < 0 OR NEW.strength > 1
    THEN RAISE(ABORT, 'outcome.strength out of range')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_claim_outcomes_validate_update
BEFORE UPDATE ON claim_outcomes
BEGIN
  SELECT CASE
    WHEN NEW.outcome_type NOT IN ('test_pass', 'test_fail', 'build_pass', 'build_fail', 'commit_kept', 'commit_reverted', 'issue_closed', 'issue_reopened', 'human_kept', 'human_corrected', 'manual_override')
    THEN RAISE(ABORT, 'invalid outcome.outcome_type')
  END;
  SELECT CASE
    WHEN NEW.strength < 0 OR NEW.strength > 1
    THEN RAISE(ABORT, 'outcome.strength out of range')
  END;
END;
