# Claude Code Local Validation

This runbook is for validating the current Claude Code reference adapter locally.

It is intentionally narrow. It proves the current spike can:

- install managed Claude hook settings into `.claude/settings.local.json`
- validate that the managed hook entries are present and non-duplicated
- record a real hook-driven `PostToolUseFailure` event into runtime storage
- inject meaningful `SessionStart` recall in the next Claude session

It does **not** prove:

- production packaging or global Claude installation support
- public message APIs emitting trusted `claude_code.hook.*` capture paths
- broader adapter effectiveness beyond the tested SessionStart + tool-observation path

## Preconditions

- Node `20.x`
- `pnpm@9`
- dependencies installed in this repo
- Claude Code available locally
- run all commands from the repo root:
  `/Users/slicenfer/Development/projects/self/project-memory-runtime`

Recommended baseline:

```bash
node -v
pnpm -v
pnpm run build
```

Expected:

- Node reports `v20.x`
- `pnpm run build` completes successfully

## Clean Start

Use a clean local state so the first `SessionStart` is easy to reason about.

```bash
rm -rf .memory/project-memory
rm -f .claude/settings.local.json
mkdir -p .claude
```

Expected after cleanup:

- no adapter-managed runtime DB exists yet
- no adapter-managed session marker exists yet

## 1. Install Managed Claude Hook Settings

Install the local Claude settings for this repo:

```bash
node ./packages/adapters/claude-code/dist/cli.js install-settings \
  --settings-file .claude/settings.local.json
```

Expected:

- command exits `0`
- `.claude/settings.local.json` is created
- stdout is JSON containing:
  - `settings_file`
  - `managed_command`
  - `settings.hooks`

The managed settings should cover exactly these events:

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`
- `PreCompact`

## 2. Validate Installed Settings

Run the built-in validator before opening Claude:

```bash
node ./packages/adapters/claude-code/dist/cli.js validate-settings \
  --settings-file .claude/settings.local.json
```

Expected:

- command exits `0`
- stdout JSON contains `"is_valid": true`
- `missing_events` is empty
- `duplicate_events` is empty

If this step fails, do not continue to Claude yet. Fix settings first.

## 3. Start Claude Code In This Repo

Open Claude Code from the repo root and start a fresh session.

Expected on the very first clean session:

- Claude starts normally
- there is usually **no** `Project Memory` block yet

If a `Project Memory` block already appears on a clean start, local memory was not actually reset.

## 4. Force One Deterministic Failing Tool Observation

In that Claude session, ask Claude to run exactly one Bash command and not modify code:

```bash
pnpm test --help >/dev/null 2>&1; echo 'Test failed: Claude hook local validation' >&2; exit 1
```

Why this command:

- it still matches the adapter's `pnpm test` classifier
- it fails deterministically
- it emits a stable `Test failed: ...` line that the current parser can turn into an open thread

Expected:

- Claude reports the Bash command failed
- a runtime DB should now exist at:
  `.memory/project-memory/runtime.sqlite`

## 5. Start A New Claude Session

End the current Claude session, then start a **new** session in the same repo.

Use a new session, not a resume inside the same session identity. Session brief dedupe is keyed by `{project_id, workspace_id, session_id}`.

Expected:

- Claude startup includes a `Project Memory` block
- that injected text contains `Claude hook local validation`
- the recall is carried through `SessionStart`, not by manually calling any memory tool

This is the main functional success criterion.

## 6. Inspect Runtime Artifacts

If the UI behavior is ambiguous, inspect the runtime directly.

First derive the adapter project id:

```bash
export PM_PROJECT_ID="$(
  node -e 'import("./packages/adapters/claude-code/dist/index.js").then((m) => console.log(m.defaultClaudeProjectId(process.cwd())))'
)"
echo "$PM_PROJECT_ID"
```

Expected:

- for a repo with `origin`, this should be a normalized repo id such as `github.com/acme/demo`
- for a local-only repo, this will be `local:<sha256>`

Inspect recorded events:

```bash
pnpm run memoryctl -- inspect events \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID" \
  --json
```

Expected:

- at least one `session_start` event
- at least one `test_result` event

Inspect claims:

```bash
pnpm run memoryctl -- inspect claims \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID" \
  --json
```

Expected:

- at least one open thread claim derived from the failing tool observation
- in this validation flow it should reference `Claude hook local validation`

Inspect the current snapshot:

```bash
pnpm run memoryctl -- snapshot \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID"
```

Expected:

- `open_threads` should be at least `1`
- the brief should no longer look empty

Optional filesystem checks:

```bash
ls -R .memory/project-memory
```

Expected:

- `runtime.sqlite`
- `claude-code/session-brief-markers/`

## Success Criteria

Treat the local validation as passing only if all of these are true:

- `install-settings` succeeds
- `validate-settings` returns `"is_valid": true`
- the first clean Claude session does not show fake/stale recall
- the deterministic failing Bash command creates runtime storage
- the next fresh Claude session injects a `Project Memory` block mentioning `Claude hook local validation`
- `memoryctl snapshot` shows at least one open thread for the current project

## Failure Triage

### `validate-settings` returns `is_valid=false`

Likely causes:

- `.claude/settings.local.json` was hand-edited
- the managed entries were duplicated
- some supported hook events are missing

Fix:

```bash
node ./packages/adapters/claude-code/dist/cli.js install-settings \
  --settings-file .claude/settings.local.json
node ./packages/adapters/claude-code/dist/cli.js validate-settings \
  --settings-file .claude/settings.local.json
```

### `.memory/project-memory/runtime.sqlite` never appears

Likely causes:

- Claude did not load `.claude/settings.local.json`
- Claude was not started from this repo
- the hook command failed before writing anything

Check:

- `.claude/settings.local.json` exists in the repo root
- the managed command inside it points at `project-memory-claude-hook`
- Claude was launched from this repo directory

### Second session shows no `Project Memory` block

Check the runtime data first:

```bash
pnpm run memoryctl -- inspect events \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID"
```

Interpretation:

- no `test_result` event: Claude did not execute the Bash tool path as expected
- `test_result` exists but no useful thread/claim: the command output did not match the current parser strongly enough
- useful thread exists but no startup injection: the second startup likely reused a deduped session identity or did not trigger the expected `SessionStart` path

### Recall is injected once, then disappears on immediate retry

That can be correct behavior. Session brief dedupe is persisted under:

```text
.memory/project-memory/claude-code/session-brief-markers/
```

If the packet is unchanged and the session identity is the same, repeated startup injection is intentionally suppressed.

## Reset Between Runs

If you need to re-run the validation from scratch:

```bash
rm -rf .memory/project-memory
rm -f .claude/settings.local.json
```

Then repeat from step 1.
