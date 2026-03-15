# Runtime Benchmarks

Runtime-only benchmark harness for `Project Memory Runtime`.

Current suites:

- session recovery
- stale suppression
- outcome learning
- multi-agent consistency

Current outputs distinguish:

- `overall_pass`: runtime hardening gate
- `adapter_readiness_pass`: stricter pre-adapter gate

Run from repo root:

```bash
pnpm run benchmark:runtime
```

Notes:

- Output is written to `tools/benchmarks/tmp/benchmarks/`
- Files under `tools/benchmarks/tmp/benchmarks/` are local-only scratch artifacts and are not the source of truth for merge decisions
- Node 20 CI benchmark artifacts should be treated as the authoritative go/no-go evidence
