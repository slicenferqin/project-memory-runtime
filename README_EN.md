# Project Memory Runtime

<div align="center">

**A local-first lifecycle memory runtime for coding agents**

[简体中文](./README.md) | English

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Status: Phase%201%20Baseline](https://img.shields.io/badge/Status-Phase%201%20Baseline-orange)](./docs/planning/phase-1-implementation-plan.md)
[![Architecture: Runtime First](https://img.shields.io/badge/Architecture-Runtime%20First-black)](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)

[Why](#why) • [Principles](#principles) • [Structure](#repository-structure) • [Status](#current-status) • [Start Here](#start-here)

</div>

---

## Why

`Project Memory Runtime` is not another memory MCP server, and not just a CLI that agents must remember to call.

It is designed to solve problems like:

- restoring project state in a new session
- preventing old decisions from being retried blindly
- carrying unfinished threads across sessions
- deciding which memories are trustworthy, stale, or useful
- letting multiple coding agents share the same project state

Its goal is not to “remember like a human,” but to:

> **preserve evidence, compile memory, activate selectively, and let outcomes reshape memory over time.**

---

## Principles

### 1. Lifecycle-first

Prefer passive capture and injection through hooks, plugins, and lifecycle events instead of hoping the agent remembers to call a tool at the right time.

### 2. Evidence-first

Raw evidence is the source of truth.  
Claims must be traceable back to evidence.

### 3. Runtime-first

The main deliverable is the **memory runtime**, not an MCP server.  
MCP is only a compatibility bridge. CLI is only an operator surface.

### 4. Outcome-aware

Memory quality is shaped not only by relevance and freshness, but also by real engineering outcomes:

- tests passing or failing
- commits being kept or reverted
- issues being closed or reopened
- humans keeping or correcting agent output

### 5. Project Memory, not Human Memory

This repository focuses on **project memory for coding agents**, not personality or companionship memory.

---

## Repository Structure

```text
project-memory-runtime/
├── docs/
│   ├── planning/
│   └── reviews/
├── packages/
│   ├── runtime/
│   ├── adapters/
│   │   ├── claude-code/
│   │   └── opencode/
│   └── bridges/
│       └── mcp/
└── tools/
    └── memoryctl/
```

---

## Current Status

This repository has completed the **Phase 1 runtime baseline**, including:

- SQLite-backed ledger / claim / outcome / activation log storage
- deterministic compiler baseline
- lifecycle + outcome loop baseline
- activation + recall baseline
- runtime-only benchmark harness

The current focus is no longer expanding contracts, but:

- hardening runtime invariants
- expanding high-value claim families
- making benchmark results reproducible
- only then wiring the first Claude Code reference adapter

Common local verification entrypoints:

- Node `20.x`
- `pnpm run test`
- `pnpm run benchmark:runtime`
- `pnpm run rebuild:native`

---

## Start Here

Recommended reading order:

1. [Contract Index](./docs/planning/contract-index.md)
2. [V2 Design](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)
3. [Identity And Scope v1](./docs/planning/identity-and-scope-v1.md)
4. [State Machine v1](./docs/planning/state-machine-v1.md)
5. [Schema v1](./docs/planning/schema-v1.md)
6. [Claim Family Registry v1](./docs/planning/claim-family-registry-v1.md)
7. [Adapter Contract v1](./docs/planning/adapter-contract-v1.md)
8. [Evaluation Protocol v1](./docs/planning/evaluation-protocol-v1.md)
9. [Compiler And Ingestion v1](./docs/planning/compiler-and-ingestion-v1.md)

---

## Relationship to `universal-memory-mcp`

`universal-memory-mcp` still matters, but it is now better positioned as:

- a legacy compatibility line
- a maintenance line
- a future MCP bridge / adapter source

This repository is the new runtime-first mainline.

Legacy repository:

- [slicenferqin/universal-memory-mcp](https://github.com/slicenferqin/universal-memory-mcp)

---

## License

This repository is licensed under **GPL-3.0**.

The legacy repository keeps its own licensing and maintenance strategy.
