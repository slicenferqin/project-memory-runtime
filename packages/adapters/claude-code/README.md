# Claude Code Adapter

Reference adapter spike for Claude Code.

Current scope is intentionally narrow:

- runtime-first local library
- stdin/CLI entrypoint for hook execution
- controlled `capture_path` mapping
- `SessionStart` recall injection
- `PostToolUse` capture normalization
- `Stop` / `SessionEnd` lifecycle capture
- local smoke tests only

Current trust boundary in this spike:

- plain message payloads are normalized as `import.transcript`
- only tool observations are upgraded to trusted `system.tool_observation`
- `claude_code.hook.*` capture paths remain reserved for future real hook-envelope integration, and are not emitted by the current public message API

Not included in this spike:

- real Claude Code installation wiring
- production hook packaging
- transcript persistence outside runtime
- broad tool coverage beyond the tested normalization rules

Primary integration points:

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`

Exports:

- `createClaudeCodeRuntime(config)`
- `ClaudeCodeAdapter`
- `defaultClaudeProjectId(cwd)`
- `project-memory-claude-hook` CLI

Notes:

- `createClaudeCodeRuntime()` does not enable `claude_code.hook.*` by default
- future real hook-envelope integrations must opt in explicitly with `enable_claude_hook_capture_paths: true`
- `createClaudeCodeRuntime()` rejects any manual `claude_code.hook.*` allowlist unless `enable_claude_hook_capture_paths: true` is explicitly set
- `defaultClaudeProjectId(cwd)` follows `origin > upstream > unique other remote`, and falls back to `local:<sha256(git_root)>` only for local-only repos
- if multiple non-priority remotes exist and no `origin` / `upstream` is present, `defaultClaudeProjectId(cwd)` fails closed and the caller must provide `project_id`
- session brief dedupe is persisted under the runtime data dir and keyed by `{project_id, workspace_id, session_id}`, so it can suppress repeats across adapter instances without crossing project boundaries

CLI usage:

```bash
cat hook-envelope.json | project-memory-claude-hook --data-dir .memory
```

Current CLI support:

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`
- `PreCompact`
