---
name: project-memory
autoApply: always
---
# Project Memory — Evidence-backed recall

Your project has a memory system that tracks verified decisions, facts,
and open threads. Memory is captured automatically from your tool use.

## Auto-injection
Session brief is injected automatically at session start via hooks.

## Mid-session retrieval
When you need to recall project decisions or check evidence, use Bash:
- `pmr search "<query>"` — find relevant decisions, facts, threads
- `pmr explain <claim-id>` — trace a claim to its evidence and outcomes
- `pmr snapshot` — full project memory overview
- `pmr status` — memory database statistics

## When to use
- User asks "why did we decide X?" → `pmr search "X"`
- User questions a past decision → `pmr explain <id>` to show evidence
- Starting complex work → `pmr snapshot` for full context
- Debugging a failure → `pmr search --type thread` for open issues
