# Persistent Project Memory Kernel V2

**日期：** 2026-03-12  
**状态：** Draft v2 for implementation planning  
**来源：** 基于 V1 设计稿与 Claude / Gemini / GPT-5.4 三份交叉评审综合收敛  
**目标：** 将“方向正确”的设计稿收紧成“可落地、可验证、可迁移”的内核规范

---

## 1. V2 结论

V2 的核心结论有三条：

1. **主交付物不是 MCP server，也不是 CLI，而是一个本地优先、全生命周期的项目记忆运行时。**
2. **主接入方式不是 agent 主动调用 memory tool，而是 hooks / plugins 驱动的被动记忆闭环。**
3. **真正的差异化不在于“能不能记住”，而在于“这条记忆是否可信、是否过时、是否有效、是否可被多 agent 共享”。**

因此，本项目在 V2 中重新定义为：

> **A local-first lifecycle memory runtime for coding agents**  
> **面向代码 Agent 的本地优先、全生命周期项目记忆运行时**

更完整的定位语是：

> **A local-first persistent project memory kernel for coding agents that turns project evidence into verifiable, scoped, outcome-aware memory shared across sessions and agents.**

---

## 2. 为什么需要 V2

V1 的方向判断已经被三份独立评审共同确认：

- 从“通用 memory 插件”收窄到 “Persistent Project Memory Kernel” 是正确方向
- `Project Memory > Human Memory` 是更稳的 wedge
- `Evidence -> Claim -> Activation -> Outcome Feedback` 是更有壁垒的抽象
- `Outcome-aware Memory` 是最有差异化价值的能力

但 V1 仍然更像“方向稿”，主要问题包括：

- 事件模型还不足以支撑 outcome loop
- claim 契约还不够硬
- 状态机尚未定义
- activation 还停留在概念公式
- compiler 触发模型未明确
- tool surface 还没有体现 evidence-first 原则
- 迁移路径与评估协议不够具体

V2 的任务不是改变方向，而是把这些系统约束补齐。

---

## 3. 交付物定义

### 3.1 主交付物

V2 的主交付物定义为：

### **Project Memory Runtime**

它负责：

- evidence persistence
- claim lifecycle
- activation policy
- recall packaging
- outcome feedback ingestion
- migration compatibility

它**不是**：

- 一个单纯的 MCP server
- 一个只供 agent 主动调用的 CLI
- 一个泛聊天长期记忆插件

### 3.2 配套交付物

V2 拆分为四个产品面：

1. **`project-memory-runtime`**
   内核本体，负责 ledger、claims、activation、compiler、outcomes。

2. **Lifecycle adapters**
   负责和具体 agent 的 hooks / plugins / transcripts 对接。

3. **`memoryctl`**
   人工与运维接口，用于 inspect、verify、snapshot、reindex、debug。

4. **Optional MCP bridge**
   仅作为兼容层暴露少量 memory tools，不承担主 capture 路径。

---

## 4. 接入策略：Lifecycle-first, Transport-agnostic

V2 采用以下策略：

> **Lifecycle-first, transport-agnostic**  
> 以生命周期被动接入为优先，传输与暴露方式保持中立。

### 4.1 优先级顺序

1. **hooks / plugins**
   作为主 capture 与 recall 路径。

2. **sidecar / transcript ingest**
   当目标 agent 没有成熟 plugin/hook 能力时的过渡方案。

3. **CLI**
   作为人工、运维、调试接口，而不是主产品形态。

4. **MCP**
   作为兼容桥接层，而不是架构中心。

### 4.2 原则

- 能被动接入，就不依赖 agent 主动调用
- 能通过生命周期事件获得信号，就不通过提示词诱导“记得调用工具”
- MCP 与 CLI 只承担辅助面，不承担核心记忆采集与编译职责

---

## 5. 目标与非目标

### 5.1 目标

V2 目标是构建一个可以在 coding agent 场景下稳定运行的项目记忆内核，支持：

- 跨 session 的项目状态恢复
- 决策、事实、线程的结构化沉淀
- stale / superseded / archived 的状态化管理
- outcome signal 驱动的记忆强化或降权
- 多 agent 共享同一份项目状态

### 5.2 非目标

V2 不追求：

- 通用消费级聊天记忆
- 人格陪伴式长期记忆
- 复杂 UI 平台
- 首版本即全 agent 深度原生支持
- 以向量搜索效果为主卖点

---

## 6. 内核边界

### 6.1 Kernel 职责

Kernel 负责：

- evidence ledger
- claim persistence
- claim lifecycle transitions
- activation eligibility
- activation ranking
- recall packet assembly
- outcome ingestion
- verification bookkeeping

### 6.2 Adapter 职责

Adapter 只负责：

- 捕获事件
- 注入 recall
- 触发 runtime
- 将 runtime 输出映射到目标 agent 语义

一句话定义：

> **The kernel owns evidence persistence, claim lifecycle, activation, and recall packaging; adapters only capture and inject.**

---

## 7. 数据模型总览

V2 使用四个核心对象：

- `NormalizedEvent`
- `Claim`
- `Outcome`
- `RecallPacket`

V2 的原则是：

- evidence 是 source of truth
- claim 必须可追溯到 evidence
- outcome 必须能反哺 claim
- recall 必须可解释

---

## 8. `NormalizedEvent` Contract v1

### 8.1 设计原则

- 事件必须 append-only
- 事件必须带作用域
- 事件必须带 agent 身份与版本
- 事件必须允许 outcome 聚合

### 8.2 Schema

```ts
type NormalizedEvent = {
  id: string
  ts: string
  project_id: string
  session_id?: string
  agent_id: string
  agent_version?: string
  event_type:
    | "user_message"
    | "agent_message"
    | "file_edit"
    | "command_result"
    | "test_result"
    | "build_result"
    | "lint_result"
    | "benchmark_result"
    | "deploy_result"
    | "git_commit"
    | "git_revert"
    | "pr_opened"
    | "pr_merged"
    | "pr_closed"
    | "issue_link"
    | "issue_closed"
    | "issue_reopened"
    | "human_edit_after_agent"
    | "manual_override"
    | "session_start"
    | "session_end"
    | "user_confirmation"
  scope?: {
    repo?: string
    branch?: string
    cwd?: string
    files?: string[]
  }
  content: string
  metadata?: {
    exit_code?: number
    command_name?: string
    duration_ms?: number
    touched_files?: string[]
    stdout_digest?: string
    stderr_digest?: string
    issue_id?: string
    pr_id?: string
    commit_sha?: string
    actor?: "agent" | "user" | "system"
    [key: string]: unknown
  }
}
```

### 8.3 Required outcome events in v1

V2 明确要求 outcome loop 至少接入以下事件：

- `test_result`
- `build_result`
- `git_commit`
- `git_revert`
- `issue_closed`
- `issue_reopened`
- `human_edit_after_agent`
- `manual_override`

`pr_opened / pr_merged / deploy_result / benchmark_result` 可以在 v1.1 补充。

---

## 9. `Claim` Contract v1

### 9.1 V1 的 claim 先收敛为三大类

为了控制复杂度，V1 不直接把对外 claim type 扩张到过多类型，而是先收敛为：

- `fact`
- `decision`
- `thread`

内部可以保留更细的 `assertion_kind`，但 V1 对外 contract 以三类为主。

### 9.2 为什么先收三类

- 每新增一个 claim type，就会增加 verification、activation、transition、suppression 的策略复杂度
- V1 目标是闭环，不是完整 taxonomy
- `fact / decision / thread` 已足以覆盖 coding agent 场景的大部分高价值记忆

### 9.3 Schema

```ts
type Claim = {
  id: string
  project_id: string
  type: "fact" | "decision" | "thread"
  assertion_kind:
    | "fact"
    | "hypothesis"
    | "instruction"
    | "preference"
    | "todo"
    | "outcome"
  canonical_key: string
  content: string
  source_event_ids: string[]

  scope?: {
    repo?: string
    branch?: string
    cwd_prefix?: string
    files?: string[]
  }

  confidence: number
  importance: number
  outcome_score: number

  verification_status:
    | "unverified"
    | "inferred"
    | "user_confirmed"
    | "system_verified"
    | "outcome_verified"
    | "disputed"
  verification_method?:
    | "file_check"
    | "command_check"
    | "test_check"
    | "user_confirmation"
    | "git_observation"
    | "issue_pr_observation"

  status: "active" | "stale" | "superseded" | "archived"

  valid_from?: string
  valid_to?: string
  supersedes?: string[]
  pinned?: boolean
  last_verified_at?: string
  last_activated_at?: string
}
```

### 9.4 `ThreadClaim` 扩展字段

`thread` 类型必须额外具备：

```ts
type ThreadClaimExtension = {
  resolution_condition?: {
    by_issue_close?: string
    by_pr_merge?: string
    by_branch_delete?: string
    by_commit_contains?: string
  }
}
```

原则：

- `thread` 不应只靠 LLM 判断关闭
- 尽量绑定 machine-resolvable outcome signal

---

## 10. `Outcome` Contract v1

为了不把所有 outcome 信号都塞进 Claim 本体，V2 独立定义 outcome 记录。

```ts
type Outcome = {
  id: string
  ts: string
  project_id: string
  related_event_ids: string[]
  related_claim_ids?: string[]
  outcome_type:
    | "test_pass"
    | "test_fail"
    | "build_pass"
    | "build_fail"
    | "commit_kept"
    | "commit_reverted"
    | "issue_closed"
    | "issue_reopened"
    | "human_kept"
    | "human_corrected"
    | "manual_override"
  strength: number
  notes?: string
}
```

用途：

- 更新 `Claim.outcome_score`
- 支持后续 audit
- 支持 evaluation benchmark

---

## 11. `RecallPacket` Contract v1

V2 明确把 `RecallPacket` 视为一等产品接口，而不仅是中间对象。

### 11.1 设计目标

- 成为 agent 之间的公共语言
- 成为人类调试的最小可解释单元
- 成为 recall 质量评估的核心输出

### 11.2 Schema

```ts
type RecallPacket = {
  project_id: string
  generated_at: string
  agent_id: string
  brief: string
  active_claims: Array<
    Claim & {
      recall_rank: number
      activation_reasons: string[]
      evidence_refs: string[]
    }
  >
  open_threads: Array<
    Claim & {
      recall_rank: number
      activation_reasons: string[]
      evidence_refs: string[]
    }
  >
  recent_evidence_refs: string[]
  warnings?: string[]
}
```

### 11.3 必须可解释

V2 不要求每次都把 explanation 暴露给终端用户，但 runtime 必须保留：

- `activation_reasons`
- `recall_rank`
- `evidence_refs`

否则 activation engine 会变成黑箱。

---

## 12. Claim Lifecycle State Machine

### 12.1 状态定义

- `active`
  当前可参与 recall

- `stale`
  可能过时，但不等于错误；默认降权

- `superseded`
  已被更新 claim 覆盖；默认不进 recall

- `archived`
  仅保留审计与历史；不进入热路径

### 12.2 允许的迁移

```text
active -> stale
active -> superseded
active -> archived
stale -> active
stale -> superseded
stale -> archived
superseded -> archived
archived -> active   (only via explicit restore / re-verification)
```

### 12.3 自动迁移规则

- 新 claim 覆盖同一 `canonical_key` 的旧 claim：
  - 旧 claim `active -> superseded`

- 长期未验证但仍可能有效：
  - `active -> stale`

- 明确错误但需保留审计证据：
  - `active/stale -> archived`

- stale claim 被新的 evidence 再次验证：
  - `stale -> active`

### 12.4 人工确认规则

以下迁移建议要求显式人工或高置信验证：

- `archived -> active`
- 高影响 `decision` 的 `active -> superseded`
- pinned claim 的状态变更

---

## 13. Activation Pipeline v1

V2 不再使用单一乘法公式作为主模型，而采用三阶段激活。

### 13.1 Stage 1: Eligibility Filter

先做硬过滤：

- `project_id` 不匹配 -> 过滤
- `scope` 不匹配 -> 过滤
- `status == superseded` -> 过滤
- `status == archived` -> 过滤
- `valid_to` 已过期 -> 过滤

### 13.2 Stage 2: Ranking

排序阶段使用加权模型，而不是纯乘法：

```text
rank_score =
  w_r * relevance
  + w_f * freshness
  + w_c * confidence
  + w_i * importance
  + w_o * outcome_score
  + w_s * scope_match
  + w_p * pin_or_verification_bonus
```

说明：

- `pinned` claim 不应因为时间旧而失活
- `system_verified` / `user_confirmed` 应获得显式 bonus
- 新 claim 不应因为 outcome 尚少而被压到不可见

### 13.3 Stage 3: Budget Packing

在 recall token budget 内打包：

- `active_claims`
- `open_threads`
- `recent_evidence_refs`
- `brief`

打包时优先级：

1. pinned decisions
2. current-scope threads
3. high-verification facts
4. recent evidence refs

---

## 14. Memory Compiler Trigger Model

V2 明确 compiler 采用 **event-driven primary + scheduled maintenance secondary** 模式。

### 14.1 主要触发方式：事件驱动

优先在生命周期节点增量编译：

- session end / idle
- pre-compact
- post-tool-use after important actions
- issue/pr status changes

### 14.2 次要触发方式：定时维护

cron 只负责：

- stale review
- archive sweep
- backfill recompilation
- integrity checks

### 14.3 目标 agent 触发策略

#### Claude Code

优先利用官方 hooks：

- `SessionStart`
- `PostToolUse`
- `PreCompact`
- `Stop`
- `SessionEnd`

官方 hooks 文档当前已明确支持更完整 lifecycle、matcher、command/http/prompt/agent handlers 与 async hooks。  
参考：[Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)

#### OpenCode

优先通过 plugin 事件：

- `session.idle`
- message updates
- plugin-level tool observations

#### Codex

Codex 在 V2 中先使用过渡接入：

- workspace conventions
- transcript ingest
- optional MCP bridge

目标是先跑通闭环，而不是反过来让内核为某个尚不稳定的原生扩展面妥协。

---

## 15. Tool Surface v1

V2 明确采用 **evidence-first tool surface**。

### 15.1 默认工具

- `memory.record_event`
- `memory.search`
- `memory.session_brief`
- `memory.project_snapshot`
- `memory.verify_claim`
- `memory.mark_claim_stale`
- `memory.supersede_claim`

### 15.2 不作为默认路径的工具

- `memory.upsert_claim`

原因：

- 会鼓励 agent 绕过 evidence ledger
- 容易直接制造未经验证的长期记忆
- 与“claim 必须可追溯到 evidence”的原则冲突

如果未来保留 `upsert_claim`，也只适用于：

- 导入迁移
- 人工维护
- 明确用户确认场景

---

## 16. 参考适配策略

### 16.1 Claude Code

V2 继续把 Claude Code 作为第一个 reference adapter。

原因：

- 官方 hooks 能力足够强
- 官方 MCP 也足够稳定
- capture / recall / tools 三面都可接

参考：

- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)

### 16.2 OpenCode

OpenCode 更适合作为 plugin-first adapter。

策略：

- 利用事件订阅做被动 capture
- 由 plugin 负责 recall 注入
- 与 runtime 通过本地 bridge 通信

### 16.3 Codex

Codex 在 V2 中不是主参考实现，而是第二阶段验证抽象的目标。

策略：

- 先走 runtime + sidecar / convention
- 再根据后续原生能力补强 recall 注入

---

## 17. 迁移计划

V2 不是推翻现有仓库，而是升维迁移。

### 阶段一：兼容旧存储，旁路写入新内核

- 保留旧存储可读写
- 新事件同步写入 `ledger_events`
- 异步编译出 `claims`

### 阶段二：旧 recall API 代理到 activation engine

- 对外保留旧工具名或兼容层
- 底层由 keyword/vector top-k 切换为：
  - eligibility filter
  - ranking
  - budget packing

### 阶段三：旧 Markdown truth model 降级

- `daily / long_term / summary` 不再是核心 truth model
- 降级为 compiler 产物、视图或导出格式

### 迁移原则

- 对用户可见接口渐进迁移
- 对内 truth model 明确切换
- 任何 claim 都要能追溯到 evidence

---

## 18. MVP 范围

### 18.1 必做

- SQLite-based ledger
- Claim store v1
- Claim state machine v1
- Activation pipeline v1
- RecallPacket v1
- Outcome ingestion baseline
- Claude Code reference adapter
- `memoryctl` 初始 inspect / snapshot / verify 功能

### 18.2 延后

- 图谱存储
- hosted mode
- team workspace
- 多模态 evidence
- OpenClaw 深度适配
- Codex 原生 recall integration

---

## 19. Deterministic Extraction Baseline

V2 明确要求 MVP 阶段先建立 **deterministic extraction baseline**。

### 19.1 规则优先的 claim

以下 claim 在 MVP 阶段优先使用规则提取：

- repo facts
  - package manager
  - test framework
  - build command
  - branch / cwd scope

- thread candidates
  - issue linked
  - failing test
  - current hotfix branch

- outcome records
  - test pass/fail
  - git revert
  - issue close/reopen

### 19.2 LLM 增强但非强依赖的 claim

- preference
- high-level decision summary
- natural language thread summary

原则：

- 没有 deterministic baseline 的 claim，不进入 MVP 的核心闭环

---

## 20. Evaluation Protocol

V2 明确要求定义 benchmark，而不只是列指标。

### 20.1 Session Recovery Benchmark

目标：

- 在不给完整 transcript 的情况下，仅凭 `RecallPacket` 恢复当前项目状态、分支重点与 open threads

评估：

- session 恢复成功率
- 重复提问减少率

### 20.2 Stale Suppression Benchmark

目标：

- 构造一组已 superseded 的旧决策，验证系统是否仍错误召回

评估：

- stale recall rate
- superseded claim leakage

### 20.3 Outcome Learning Benchmark

目标：

- 给多条候选策略，其中部分有“测试通过 + commit retained / issue closed”历史，观察排序是否上升

评估：

- outcome-backed recall ratio
- successful strategy promotion rate

### 20.4 Multi-agent Consistency Benchmark

目标：

- 多个 agent 在同一项目上接续工作时，是否共享一致的项目状态

评估：

- multi-agent state consistency
- open thread divergence rate

---

## 21. Open Questions

以下问题需要在进入实现前确认：

1. V1 claim type 是否严格只保留 `fact / decision / thread`
2. `verification_status` 是否进入顶层 contract
3. `agent_version` 是否作为顶层必填字段
4. Codex 的第二阶段接入优先级是否高于 OpenCode
5. RecallPacket explanation 是否默认暴露给 adapter，还是仅用于 debug
6. `memory.upsert_claim` 是否完全移出 v1

---

## 22. Decisions To Confirm

以下决策建议尽快确认：

1. **主交付物：runtime，而不是 MCP**
2. **主接入方式：hooks/plugins，而不是 agent 主动调用**
3. **truth model：evidence-first**
4. **MVP 只做一个 reference adapter：Claude Code**
5. **RecallPacket 升为一等产品接口**
6. **MVP 先做 deterministic extraction baseline**

---

## 23. Immediate Next Actions

V2 完成后，建议下一步直接产出：

1. `schema-v1.md`
   - `ledger_events`
   - `claims`
   - `outcomes`
   - `activation_logs`

2. `state-machine-v1.md`
   - claim lifecycle transitions
   - automatic vs manual transitions

3. `adapter-contract-v1.md`
   - Capture / Recall / Tool adapter interfaces

4. `evaluation-protocol-v1.md`
   - benchmark cases
   - metrics collection

5. `phase-1-implementation-plan.md`
   - runtime build steps
   - Claude Code adapter build order

---

## 24. 参考资料

### 官方与公开资料

- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Mem0 OpenMemory Overview](https://docs.mem0.ai/openmemory/overview)
- [Mem0 MCP Integration](https://docs.mem0.ai/platform/features/mcp-integration)
- [LangGraph Memory Overview](https://docs.langchain.com/oss/javascript/langgraph/memory)
- [Graphiti Welcome](https://help.getzep.com/graphiti/getting-started/welcome)
- [Graphiti MCP Server](https://help.getzep.com/graphiti/getting-started/mcp-server)
- [OpenAI Developers](https://developers.openai.com/)
- [GPT-5.3-Codex model docs](https://developers.openai.com/api/docs/models/gpt-5.3-codex)

### 外部生态参考

- [mem0ai/mem0](https://github.com/mem0ai/mem0)
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
- [getzep/graphiti](https://github.com/getzep/graphiti)
- [topoteretes/cognee](https://github.com/topoteretes/cognee)
- [agiresearch/A-mem](https://github.com/agiresearch/A-mem)
- [openclaw/openclaw](https://github.com/openclaw/openclaw)

### 评审输入

- [2026-03-12-project-memory-kernel-design.md](/Users/slicenfer/Development/projects/self/universal-memory-mcp/docs/planning/2026-03-12-project-memory-kernel-design.md)
- [2026-03-12-project-memory-kernel-design-review-claude.md](/Users/slicenfer/Development/projects/self/universal-memory-mcp/docs/planning/2026-03-12-project-memory-kernel-design-review-claude.md)
- [TabAI会话_1773305094470.md](/Users/slicenfer/Development/projects/self/universal-memory-mcp/docs/planning/TabAI会话_1773305094470.md)
- [TabAI会话_1773305625429.md](/Users/slicenfer/Development/projects/self/universal-memory-mcp/docs/planning/TabAI会话_1773305625429.md)
