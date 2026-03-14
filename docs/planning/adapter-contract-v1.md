# Adapter Contract v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 runtime 与 agent adapters 的职责边界、最小接口与接入策略

---

## 1. 目的

Adapter 的职责不是“实现记忆系统”，而是把目标 agent 的生命周期信号接进 runtime，并把 recall 注入回去。

这份文档定义：

- runtime 与 adapter 的边界
- 三类 adapter 接口
- 参考平台的最小接入模式

---

## 2. Adapter 原则

- runtime 是权威内核
- adapter 只负责 capture / inject / bridge
- adapter 不直接写 claim
- adapter 不拥有 truth model
- adapter 失败不应破坏 agent 主流程

---

## 3. Adapter 类型

V1 定义三类 adapter：

1. `CaptureAdapter`
2. `RecallAdapter`
3. `ToolAdapter`

同一个平台可以由一个实现同时承担三种角色。

---

## 4. Runtime 最小接口

adapter 面向 runtime 的最小接口：

```ts
interface MemoryRuntime {
  recordEvent(event: NormalizedEvent): Promise<void>
  buildSessionBrief(input: {
    project_id: string
    session_id?: string
    workspace_id?: string
    agent_id: string
  }): Promise<RecallPacket>
  buildProjectSnapshot(input: {
    project_id: string
    scope?: Record<string, unknown>
    agent_id: string
  }): Promise<RecallPacket>
  verifyClaim(input: {
    claim_id: string
    status: "system_verified" | "user_confirmed" | "disputed"
    method: string
  }): Promise<void>
  markClaimStale(input: {
    claim_id: string
    reason: string
  }): Promise<void>
  supersedeClaim(input: {
    old_claim_id: string
    new_claim_id: string
    reason: string
  }): Promise<void>
}
```

---

## 5. `CaptureAdapter`

### 5.1 职责

- 监听 lifecycle 事件
- 转换为 `NormalizedEvent`
- 写入 runtime

### 5.2 输入来源

- hooks
- plugins
- tool observations
- transcript ingest
- filesystem or git events

### 5.3 最小接口

```ts
interface CaptureAdapter {
  adapter_id: string
  agent_id: string
  capture(input: unknown): Promise<NormalizedEvent[]>
}
```

说明：

- 返回空数组是合法行为
- adapter 不应为了“有输出”而伪造低质量 evidence

### 5.4 约束

- 必须幂等
- 同一事件重复到达时应可去重
- 不直接调用 `upsert_claim`
- `event.id` 是 primary idempotency key
- runtime 必须提供 idempotent write，相同 `event.id` 重复写入视为 no-op
- 内容级去重（相同内容不同 id）不是 v1 必须能力
- adapter 不直接生成最终 `canonical_key`，最多通过 metadata hint 提供建议
- 若提供 `metadata.memory_hints.family_hint`，必须同时提供独立 provenance 字段：
  - `source_kind`
  - `trust_level`
- runtime 不把 `event_type` 当作 provenance

---

## 6. `RecallAdapter`

### 6.1 职责

- 请求 session brief 或 project snapshot
- 注入回目标 agent 上下文

### 6.2 最小接口

```ts
interface RecallAdapter {
  adapter_id: string
  injectSessionBrief(input: {
    project_id: string
    session_id?: string
    workspace_id?: string
    agent_id: string
  }): Promise<void>

  injectProjectSnapshot(input: {
    project_id: string
    agent_id: string
    scope?: Record<string, unknown>
  }): Promise<void>
}
```

### 6.3 约束

- RecallPacket explanation 可以输出给 adapter
- 是否展示给终端用户，由 adapter 决定
- recall 注入失败不应阻塞主会话
- adapter 应尽量避免重复注入同一 packet
- 推荐使用 `generated_at`、packet hash 或 session marker 做幂等去重

---

## 7. `ToolAdapter`

### 7.1 职责

- 给 agent 提供兼容型 memory tools
- 不承担核心 capture 路径

### 7.2 V1 默认工具

- `memory.record_event`
- `memory.search`
- `memory.session_brief`
- `memory.project_snapshot`
- `memory.verify_claim`
- `memory.mark_claim_stale`
- `memory.supersede_claim`

### 7.3 非默认工具

- `memory.upsert_claim`

保留给：

- admin path
- migration path
- `memoryctl`

---

## 8. `memory.search` 语义

V1 为避免重新回到 search-centered 架构，明确：

- `memory.search` 默认搜索 **claims**
- raw evidence 搜索由 `memoryctl` 或未来 `memory.search_evidence` 提供
- 默认带当前 session 的 scope 过滤
- 显式传 `scope: {}` 时表示 project-wide 搜索

返回内容必须包含：

- 命中层级（claim / snapshot / evidence_ref）
- scope
- status
- verification summary

---

## 9. Lifecycle-first 接入策略

优先级：

1. hooks / plugins
2. sidecar / transcript ingest
3. CLI
4. MCP bridge

### 9.1 Claude Code reference adapter

推荐接入点：

- `SessionStart` -> recall
- `PostToolUse` -> capture tool outcomes
- `PreCompact` -> trigger incremental compile
- `Stop` / `SessionEnd` -> capture session-end evidence

### 9.2 OpenCode adapter

推荐接入点：

- plugin event hooks
- `session.idle`
- message update events

### 9.3 Codex adapter

V1 作为过渡接入：

- workspace conventions
- transcript ingest
- optional MCP bridge

---

## 10. Adapter 输出要求

### 10.1 对 runtime

Capture adapter 必须尽量输出：

- `project_id`
- `agent_id`
- `agent_version`
- `workspace_id`
- `scope`
- `causation_id` 或 `parent_event_id`
- 若有高置信 key 建议，可通过 `metadata.memory_hints.canonical_key_hint` 提供

### 10.2 对目标 agent

Recall adapter 应优先注入：

- `brief`
- 高优先级 `active_claims`
- `open_threads`

在 debug 模式下可附带：

- `activation_reasons`
- `evidence_refs`

---

## 11. Error handling

### 11.1 Capture failures

- 记录本地日志
- 不阻塞主会话
- 允许下次重试

### 11.2 Recall failures

- 记录本地日志
- 允许 agent 无记忆运行
- 不可破坏 session start

### 11.3 Tool failures

- 返回明确错误
- 标明是 runtime 不可用还是 query 无结果

---

## 12. Security / Trust boundaries

- adapter 不应绕过 runtime 写 claim
- adapter 不应伪造 verification status
- user-confirmed 只能来自可信用户确认路径
- system-verified 只能来自可验证检查

---

## 13. `memoryctl` 的角色

`memoryctl` 属于 operator interface，不属于 adapter。

V1 期望最小命令：

- `memoryctl inspect`
- `memoryctl snapshot`
- `memoryctl verify`
- `memoryctl explain-claim`
- `memoryctl archive`

---

## 14. 冻结的决策

1. Adapter 不直接拥有 truth model
2. Agent 默认不允许直接 `upsert_claim`
3. `memory.search` 在 v1 默认面向 claims
4. Recall explanation 默认对 adapter 可见
5. Claude Code 是第一个 reference adapter

---

## 15. 参考资料

- [schema-v1.md](./schema-v1.md)
- [Persistent Project Memory Kernel V2](./2026-03-12-project-memory-kernel-design-v2.md)
- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
