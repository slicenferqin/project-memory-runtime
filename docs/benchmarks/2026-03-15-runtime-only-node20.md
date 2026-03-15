# Runtime-only Benchmark Snapshot

- Date: `2026-03-15`
- Environment: Node `20.17.0`, pnpm `9.0.0`
- Source: `pnpm run benchmark:runtime`
- Authoritative gate: Node 20 CI artifact remains the merge/deploy source of truth

## Summary

- `overall_pass`: `true`
- `adapter_readiness_pass`: `false`

## Session Recovery

- `pass`: `true`
- `adapter_readiness_pass`: `false`
- `active_claim_recall`: `1.0`
- `open_thread_recall`: `1.0`
- `active_claim_recall_delta_vs_keyword`: `0.0`
- `open_thread_recall_delta_vs_keyword`: `0.3333`

Interpretation:

- runtime hardening gate passes
- pre-adapter gate remains blocked because active-claim recall is not yet above the keyword baseline

## Stale Suppression

- `superseded_leakage`: `0`
- `stale_selected`: `0`
- `active_replacement_rank`: `0`

## Outcome Learning

- `positive_rank_delta`: `2`
- `negative_rank_delta`: `1`
- `rounds`: `3`
- `avoidance_claim_growth`: `0`
- `packet_pollution_count`: `0`

## Multi-agent Consistency

- `active_decision_mismatch`: `0`
- `open_thread_divergence`: `0`
- `clone_consistency`: `1`
- `worktree_isolation`: `1`
- `subproject_isolation`: `1`
