# Claude Code Adapter

Reference adapter spike for Claude Code.

Local manual test runbook:

- 中文：[LOCAL-VALIDATION.zh-CN.md](./LOCAL-VALIDATION.zh-CN.md)
- English: [LOCAL-VALIDATION.md](./LOCAL-VALIDATION.md)

Current scope is intentionally narrow:

- runtime-first local library
- stdin/CLI entrypoint for hook execution
- CLI-generated Claude hook settings for local wiring
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

Install local Claude settings for this repo:

```bash
node ./packages/adapters/claude-code/dist/cli.js install-settings \
  --settings-file .claude/settings.local.json
```

This writes managed hook entries for:

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`
- `PreCompact`

By default the generated hook command is:

```bash
cd "$CLAUDE_PROJECT_DIR" && node ./packages/adapters/claude-code/dist/cli.js --data-dir "$CLAUDE_PROJECT_DIR/.memory/project-memory"
```

If you want to override the managed command explicitly:

```bash
node ./packages/adapters/claude-code/dist/cli.js print-settings \
  --command 'node ./packages/adapters/claude-code/dist/cli.js' \
  --data-dir '$CLAUDE_PROJECT_DIR/.memory/project-memory'
```

If you only want the JSON snippet without writing `.claude/settings.local.json`:

```bash
node ./packages/adapters/claude-code/dist/cli.js print-settings
```

Validate that the local Claude settings still contain exactly one managed Project Memory hook per supported event:

```bash
node ./packages/adapters/claude-code/dist/cli.js validate-settings \
  --settings-file .claude/settings.local.json
```

Operational notes:

- `install-settings` is idempotent for the managed Project Memory hook entries
- unrelated Claude hooks already present in `settings.local.json` are preserved
- the generated commands include a managed marker so later installs replace only Project Memory entries
- `SessionStart` only emits `hookSpecificOutput.additionalContext` when the recall packet contains meaningful active claims or open threads
- current public message APIs still normalize to `import.transcript`; trusted `claude_code.hook.*` capture paths remain opt-in only

Current CLI support:

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`
- `PreCompact`
