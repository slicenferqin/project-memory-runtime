# Phase 1 Implementation Plan

**日期：** 2026-03-12  
**状态：** Execution plan  
**范围：** `project-memory-runtime` 的第一阶段实现  
**目标：** 跑通从 lifecycle evidence 到 recall packet 的最短闭环，并用 Claude Code 作为第一个 reference adapter

---

## 1. Phase 1 目标

Phase 1 不追求“做完整个平台”，只追求三件事：

1. **把 contract 变成能运行的最小 runtime**
2. **把 evidence-first 的最短闭环跑通**
3. **证明这条 runtime-first / lifecycle-first 路线是对的**

换句话说，Phase 1 的成功标准不是“功能多”，而是：

- 有 ledger
- 有 claims
- 有 outcome
- 有 recall packet
- 有一个真实 agent adapter 能用
- 有 benchmark 能验证

### 1.1 Phase 1 的价值证明边界

Phase 1 不直接证明“系统已经能恢复所有高价值项目记忆”。

Phase 1 只证明三类更收敛的能力：

1. **Operational project memory**
   - repo facts
   - build/test facts
   - 当前分支 / issue / failing test / hotfix thread

2. **Explicitly confirmed local decisions**
   - 例如由 `user_confirmation` 明确确认的 decision

3. **Negative memory suppression**
   - 例如由 `commit_reverted`、`manual_override` 驱动的旧方案抑制

如果这三类能力都做不出来，就不应该继续扩大系统范围。

---

## 2. Phase 1 非目标

Phase 1 明确不做：

- 图谱存储
- 多模态 evidence
- hosted mode
- team workspace
- OpenCode 深度适配
- Codex 原生 recall integration
- 面向外部用户的完整 CLI 体验
- MCP 作为主路径

MCP bridge 在 Phase 1 里最多只做保留接口位，不作为核心交付。

---

## 3. 最终交付物

Phase 1 结束时，仓库里应具备以下可交付结果：

### 3.1 Core runtime

`packages/runtime/`

至少包含：

- SQLite schema migration
- event ingestion service
- deterministic compiler v1
- claim lifecycle manager
- activation engine v1
- recall packet builder
- outcome linking + score updater

### 3.2 Claude Code reference adapter

`packages/adapters/claude-code/`

至少包含：

- SessionStart recall injection
- SessionEnd / Stop / PostToolUse capture
- 最小配置说明
- 本地 smoke test

### 3.3 Operator surface

`tools/memoryctl/`

至少包含：

- `inspect`
- `snapshot`
- `verify`
- `explain-claim`

### 3.4 Benchmark harness

用于运行：

- Session Recovery Benchmark
- Stale Suppression Benchmark
- Outcome Learning Benchmark

说明：

- Phase 1 benchmark 的 session recovery 目标是 **constrained recovery**
- 不宣称恢复完整“关键项目知识”

### 3.5 文档补全

- Contract 文档冻结版
- 实现说明
- 初始化 README 可用

---

## 4. 实现策略

Phase 1 采用：

> **contract-first, runtime-first, one-real-adapter-first**

具体含义：

- 先以 contract 为准，不边写边改概念
- 先完成 runtime 核心，不急着铺多个平台
- 只做一个 reference adapter，把闭环跑通

优先级：

1. runtime schema 和核心逻辑
2. deterministic compiler
3. recall packet
4. Claude Code adapter
5. benchmark

补充：

- activation contract 必须先冻结，再实现 recall
- 不允许靠临时 adapter 逻辑替代 runtime 缺失的 claim 能力

---

## 5. 仓库内模块分工

### 5.1 `packages/runtime`

负责：

- SQLite persistence
- ingestion
- claim lifecycle
- activation
- outcome updates
- recall building

建议目录：

```text
packages/runtime/
├── src/
│   ├── identity/
│   ├── storage/
│   ├── ingestion/
│   ├── compiler/
│   ├── claims/
│   ├── outcomes/
│   ├── activation/
│   ├── recall/
│   └── index.ts
└── README.md
```

### 5.2 `packages/adapters/claude-code`

负责：

- hook entrypoints
- event normalization
- recall injection
- runtime bridge

### 5.3 `packages/adapters/opencode`

Phase 1 仅保留骨架和 README，不实现完整 adapter。

### 5.4 `packages/bridges/mcp`

Phase 1 仅保留薄 bridge 预留位，不进入核心路径。

### 5.5 `tools/memoryctl`

负责：

- human/operator 视角下的 inspect / verify / snapshot
- debug 输出
- 后续 migration/admin path

---

## 6. 里程碑

Phase 1 拆成 5 个 milestone。

---

## 7. Milestone 1: Runtime Skeleton

### 7.1 目标

搭出 runtime 可运行骨架和 SQLite 基础表。

### 7.2 产出

- `packages/runtime/package.json`
- TypeScript build setup
- SQLite 初始化模块
- 基础目录结构
- 最小 runtime entrypoint

### 7.3 必建数据表

- `ledger_events`
- `claims`
- `claim_outcomes`
- `claim_transitions`
- `activation_logs`

### 7.4 验收标准

- 本地可初始化数据库
- 可插入最小 event / claim / outcome
- migration 可重复运行
- 对重复初始化幂等

---

## 8. Milestone 2: Ingestion + Deterministic Compiler

### 8.1 目标

把 event 写入 ledger，并跑通 deterministic extraction baseline。

### 8.2 第一批 deterministic extractors

必须实现：

- `repo.package_manager`
- `repo.test_framework`
- `repo.build_command`
- `thread.issue.<id>`
- failing test thread
- hotfix branch thread

必须补一个最小高价值 family：

- 显式确认的局部 decision
- 由 `manual_override` / `commit_reverted` 驱动的被否定旧方案

### 8.3 关键能力

- `recordEvent()`
- idempotent write by `event.id`
- compiler trigger routing
- `canonical_key` generation
- singleton/set handling

### 8.4 验收标准

- 同一事件重复写入不重复落库
- deterministic extractor 能从 fixture event 中稳定产出 claim
- `canonical_key` 命名符合 contract
- singleton key 可触发 supersede 路径
- 至少一类 explicit decision claim 可被稳定产出
- 至少一类 negative-memory claim 可被稳定抑制

---

## 9. Milestone 3: Lifecycle + Outcome Loop

### 9.1 目标

把状态机和 outcome 回流变成可执行逻辑。

### 9.2 关键能力

- `active / stale / superseded / archived`
- `thread_status = open / resolved / blocked`
- stale TTL sweep
- outcome linking
- `outcome_score` update rule
- transition audit logging

### 9.3 特别注意

必须严格遵守：

- `last_activated_at` 不延长 stale TTL
- `ActivationLog` 与 `claim_transitions` 不混用
- `thread` 完成默认 `resolved + archived`

### 9.4 验收标准

- stale sweep 可跑
- outcome 正负更新可被单测覆盖
- thread resolution rule 可驱动 resolved
- claim transition 记录完整

---

## 10. Milestone 4: Activation + Recall

### 10.1 目标

生成可解释的 `RecallPacket`。

### 10.2 关键能力

- eligibility filter
- ranking with default weights
- budget packing
- `brief` rule-based generation
- `ActivationLog` suppression tracking

附加要求：

- candidate pool 不能默认等于所有 active claims
- `session_brief`、`project_snapshot`、`memory.search` 的 candidate 入口必须分开实现

### 10.3 默认输出

- `buildSessionBrief()`
- `buildProjectSnapshot()`

### 10.4 验收标准

- RecallPacket 中每条 claim 都带 `activation_reasons`
- `open_threads` 不包含 resolved thread
- suppression 原因能被记录
- `brief` 可在 500 tokens 内生成

---

## 11. Milestone 5: Claude Code Reference Adapter

### 11.1 目标

用一个真实 adapter 验证 runtime 路线。

### 11.2 接入点

优先实现：

- `SessionStart`
- `PostToolUse`
- `Stop`
- `SessionEnd`

`PreCompact` 可作为 Phase 1 后半段增强点，不必一开始就实现。

### 11.3 adapter 最小能力

- 捕获 lifecycle 事件
- 转换成 `NormalizedEvent`
- 请求 `RecallPacket`
- 注入 session brief
- 对重复 packet 做去重

### 11.4 验收标准

- 在 Claude Code 场景中完成最短闭环：
  - 事件捕获
  - runtime 编译
  - 新 session 注入 recall
- 不因 adapter 失败阻塞主流程

---

## 12. 执行顺序

推荐顺序：

1. runtime skeleton
2. deterministic compiler
3. lifecycle + outcome
4. activation + recall
5. Claude adapter
6. benchmark harness
7. `memoryctl`

说明：

- `memoryctl` 不必阻塞核心 runtime
- benchmark 不必等 adapter 全部完成才开始
- OpenCode / MCP bridge 均不进入 Phase 1 主路径

---

## 13. 单测与验证策略

### 13.1 Runtime 单测

优先覆盖：

- idempotent event write
- deterministic extraction
- canonical key rules
- singleton supersede
- stale TTL logic
- outcome score update
- thread resolution
- recall packet assembly

### 13.2 Fixture 设计

建议建立：

- 单仓库 fixture
- hotfix branch fixture
- monorepo fixture
- reverted strategy fixture
- human override fixture

### 13.3 集成测试

Phase 1 需要至少两类：

- runtime-only replay test
- Claude adapter smoke test

---

## 14. Benchmark 计划

Phase 1 不要求 benchmark 做到很漂亮，但必须跑通。

最小范围：

- Session Recovery Benchmark
- Stale Suppression Benchmark
- Outcome Learning Benchmark

Multi-agent Consistency 可以先做 runtime-only 回放版，暂不要求多 adapter 联调。

其中：

- Session Recovery Benchmark 采用 constrained recovery 口径
- 先验证 operational memory、explicit decision、negative suppression
- 不在 Phase 1 宣称已恢复完整项目决策系统

---

## 15. `memoryctl` 范围

Phase 1 中，`memoryctl` 的目标是可调试，不是可售卖。

最小命令：

- `memoryctl inspect events`
- `memoryctl inspect claims`
- `memoryctl snapshot`
- `memoryctl verify <claim-id>`
- `memoryctl explain-claim <claim-id>`

暂不做：

- 完整 TUI
- 批量修复工具
- 花哨输出

---

## 16. 具体任务拆分建议

### Workstream A: Storage

- 初始化 SQLite
- migration runner
- repository layer

### Workstream B: Compiler

- deterministic extractors
- key generation
- conflict handling

### Workstream C: Lifecycle

- stale sweep
- supersede logic
- transition logging

### Workstream D: Recall

- ranking
- packet assembly
- brief generation

### Workstream E: Adapter

- Claude hook entrypoints
- normalization
- injection

### Workstream F: Benchmarks

- fixtures
- replay harness
- baseline runner

---

## 17. 风险与应对

### 17.1 Risk: 过早复杂化

表现：

- 过多 claim 类型
- 过早引入图谱
- 过早依赖 LLM 编译

应对：

- 坚持 deterministic baseline
- 只做一个 reference adapter

### 17.2 Risk: Adapter 拉着内核跑偏

表现：

- 为 Claude/OpenCode 某个怪异行为修改核心 schema

应对：

- adapter 适配问题优先在 adapter 层解决
- 不轻易修改 runtime truth model

### 17.3 Risk: Recall 看起来聪明，但不可测

应对：

- benchmark 先行
- suppression logging 必须保留

### 17.4 Risk: Claim pollution

表现：

- 同一主题被写成多个近似 claim
- 错误 claim 进入长期层后持续污染 recall
- `canonical_key` 不稳定导致 supersede 失效

应对：

- evidence-first，不允许 agent 默认直接写 claim
- deterministic extractors 先行
- `canonical_key` 由 compiler 统一生成
- claim type 维持极简，只保留 `fact / decision / thread`

### 17.5 Risk: Recall degenerates into noise ranking

表现：

- recall 看起来“有记忆”，但稳定召回错东西
- stale / superseded claim 被高频带出
- token budget 被低价值 claim 挤占

应对：

- 坚持 eligibility filter -> ranking -> budget packing
- `ActivationLog` 与 suppression logging 必须可用
- 优先做 stale suppression benchmark，而不是只看命中率

### 17.6 Risk: Wrong memory is worse than no memory

表现：

- agent 基于错误 claim 修改代码、执行命令、推进决策
- 系统表面稳定，但行为逐步恶化

应对：

- Phase 1 只验证最短闭环，不扩 scope
- 先做一个真实 adapter，不并行铺多个平台
- 对 decision/thread 的状态迁移保持保守

---

## 18. 不做的事清单

为了保证节奏，Phase 1 中明确不做：

- UI dashboard
- hosted API
- graph database
- 多平台并行深度适配
- agent 直接写 claim
- 面向终端用户的 polished CLI 产品体验

---

## 19. Kill Criteria

Phase 1 必须尽早验证这条路线是否值得继续投。

如果以下任一情况持续成立，应暂停扩大系统，而不是继续叠功能：

1. **Session Recovery 做不出稳定提升**  
   相对 no-memory baseline，恢复效果没有明显改善。

2. **Stale / superseded claim 无法稳定压制**  
   recall 长期带出错误历史，导致 agent 行为退化。

3. **Outcome 无法改变排序**  
   即使有 test/commit/issue 信号，排序仍没有可测变化。

4. **Claim 生成高度依赖人工纠偏**  
   deterministic baseline 无法撑起最小闭环。

5. **Claude Code reference adapter 无法稳定跑通最短闭环**  
   capture / compile / recall 任一环节持续不稳定。

这五条不是“可优化项”，而是是否继续投入的止损条件。

---

## 20. Phase 1 完成定义

Phase 1 完成时，必须同时满足：

1. SQLite runtime 可以稳定写入 event / claim / outcome
2. deterministic extractors 跑通
3. claim lifecycle 可执行
4. recall packet 可解释
5. Claude Code reference adapter 跑通最短闭环
6. 至少 3 组 benchmark 可执行
7. `memoryctl` 能完成 inspect / verify / snapshot / explain

---

## 21. 下一步文档

在这份实施计划之后，建议继续产出：

- `runtime-package-spec.md`
- `sqlite-schema.sql` 或等价 migration 文件
- `claude-adapter-implementation-notes.md`
- `benchmark-fixtures.md`

---

## 22. 参考资料

- [Contract Index](./contract-index.md)
- [Identity And Scope v1](./identity-and-scope-v1.md)
- [State Machine v1](./state-machine-v1.md)
- [Schema v1](./schema-v1.md)
- [Adapter Contract v1](./adapter-contract-v1.md)
- [Evaluation Protocol v1](./evaluation-protocol-v1.md)
- [Compiler And Ingestion v1](./compiler-and-ingestion-v1.md)
- [V2 Design](./2026-03-12-project-memory-kernel-design-v2.md)
