# Claude Agent SDK Adapter

Project Memory Runtime adapter for the official TypeScript `@anthropic-ai/claude-agent-sdk`.

This package is for **application-level integration** with the SDK. It does **not**
use Claude Code's user-level hook settings and it does **not** depend on
`pmr install-global`.

Use this package when your app calls `query({ prompt, options })` directly.

## What it provides

- `createProjectMemoryHooks(config?)`
- `withProjectMemory(options?, config?)`

Both APIs reuse the existing Claude Code adapter pipeline internally:

- runtime location resolution
- normalized lifecycle event capture
- session brief injection
- checkpoint capture and verification
- activation writeback
- artifact refs for structured tool observations

## Minimal usage

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { withProjectMemory } from "@slicenfer/project-memory-adapter-claude-agent-sdk";

const stream = query({
  prompt: "Fix the failing tests in this repo.",
  options: withProjectMemory({
    cwd: process.cwd(),
    permissionMode: "acceptEdits",
    settingSources: ["project"],
  }),
});

for await (const message of stream) {
  console.log(message);
}
```

## Important behavior

- The SDK defaults to isolation mode. No filesystem settings are loaded unless the
  application passes `settingSources`.
- Project Memory does not add `settingSources` automatically.
- If your app needs `CLAUDE.md`, `.claude/skills`, or project/local Claude settings,
  pass `settingSources` yourself.
- Outside git repositories the adapter is a no-op.
- Runtime routing still follows:
  `explicit path > repo override > legacy local > shared global DB`

## Relationship to Claude Code global install

- `pmr install-global` is only for Claude Code's shell hook integration.
- SDK apps must opt in by wrapping their own SDK options with `withProjectMemory()`.
- The SDK adapter does not read or manage `~/.claude/settings.local.json`.
