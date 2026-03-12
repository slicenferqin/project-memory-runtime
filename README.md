# Project Memory Runtime

Local-first lifecycle memory runtime for coding agents.

This repository is the new mainline for the V2 architecture that evolved out of `universal-memory-mcp`.

The core shift is simple:

- not MCP-first
- not CLI-first
- lifecycle-first
- evidence-first
- outcome-aware

The runtime is intended to help coding agents share the same project state across:

- sessions
- branches
- workspaces
- agents

It does this by turning raw project evidence into:

- verifiable claims
- scoped recall packets
- outcome-aware memory updates

## What Lives Here

- `docs/planning/`
  V2 architecture and implementation contracts.
- `docs/reviews/`
  Cross-review artifacts used to harden the design.
- `packages/runtime/`
  Future runtime implementation.
- `packages/adapters/claude-code/`
  Future Claude Code lifecycle adapter.
- `packages/adapters/opencode/`
  Future OpenCode plugin adapter.
- `packages/bridges/mcp/`
  Optional MCP compatibility bridge.
- `tools/memoryctl/`
  Future operator CLI.

## Current Status

This repository is still in design-freeze mode.

The current goal is to finish and stabilize the following contract set before Phase 1 implementation:

- `identity-and-scope-v1`
- `state-machine-v1`
- `schema-v1`
- `adapter-contract-v1`
- `evaluation-protocol-v1`
- `compiler-and-ingestion-v1`

Start here:

- [Contract Index](./docs/planning/contract-index.md)
- [V2 Design](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)

## Relationship To `universal-memory-mcp`

`universal-memory-mcp` remains valuable as:

- a legacy compatibility line
- a maintenance line for existing users
- a future MCP bridge and adapter source

This repository is where the new runtime-first architecture continues.
