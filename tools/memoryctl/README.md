# memoryctl

Minimal operator CLI for `Project Memory Runtime`.

Phase 1 commands:

- `memoryctl inspect events`
- `memoryctl inspect claims`
- `memoryctl snapshot`
- `memoryctl verify <claim-id>`
- `memoryctl explain-claim <claim-id>`

Examples:

```bash
pnpm run memoryctl -- inspect claims --project github.com/acme/demo --json
pnpm run memoryctl -- snapshot --project github.com/acme/demo --branch fix/windows-install
pnpm run memoryctl -- verify clm-123 --status system_verified --method runtime_check
pnpm run memoryctl -- explain-claim clm-123 --json
```
