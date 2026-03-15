# Claude Code Adapter

Reference adapter spike for Claude Code.

Current scope is intentionally narrow:

- runtime-first local library
- controlled `capture_path` mapping
- `SessionStart` recall injection
- `PostToolUse` capture normalization
- `Stop` / `SessionEnd` lifecycle capture
- local smoke tests only

Not included in this spike:

- real Claude Code installation wiring
- production hook packaging
- transcript persistence outside runtime
- broad tool coverage beyond the tested normalization rules

Primary integration points:

- `SessionStart`
- `PostToolUse`
- `Stop`
- `SessionEnd`

Exports:

- `createClaudeCodeRuntime(config)`
- `ClaudeCodeAdapter`
- `defaultClaudeProjectId(cwd)`
