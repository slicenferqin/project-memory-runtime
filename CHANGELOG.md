# Changelog

## [0.2.0] - 2026-04-01

### Added
- **6 New Claude Code Hooks** for enhanced memory capture:
  - `UserPromptSubmit`: Records user messages and injects relevant memory context based on query
  - `PostCompact`: Captures session summaries after transcript compaction
  - `StopFailure`: Records interrupted sessions with error metadata
  - `SubagentStop`: Tracks sub-agent completion with metadata
  - `PreToolUse`: Query-only hook (Bash commands) that injects context without recording events
  - `Setup`: Triggers maintenance sweep of stale claims on startup
- `injectAdditionalContext()` method in ClaudeCodeAdapter for lightweight memory queries
- 22 comprehensive tests for new hooks (unit + integration + E2E)

### Changed
- `ClaudeCodeAdapter.record()` now accepts `null` input for query-only hooks
- CLI now outputs `additionalContext` JSON responses for UserPromptSubmit and PreToolUse hooks
- `executeClaudeHookEnvelope()` extended to handle additional context injection and maintenance sweeps

## [0.1.0] - 2026-03-30

### Added
- Initial release of Project Memory Runtime
- 4-layer architecture: Evidence Ledger → Claim Store → Activation Engine → Outcome Loop
- SQLite storage with 5 migrations
- Deterministic claim compilation from events
- Activation engine with eligibility filtering, ranking, and budget packing
- Outcome visualization with timeline and score deltas
- Claude Code adapter with 6 lifecycle hooks (SessionStart, PostToolUse, PostToolUseFailure, Stop, SessionEnd, PreCompact)
- CLI with 5 commands: init, search, explain, snapshot, status
- 86 tests across runtime, adapter, and CLI packages
