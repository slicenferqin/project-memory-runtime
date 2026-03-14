# Schema v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 runtime 核心对象、字段约束、默认值与 v1 算法参数

---

## 1. 依赖文档

本文件依赖：

- [identity-and-scope-v1.md](./identity-and-scope-v1.md)
- [state-machine-v1.md](./state-machine-v1.md)

---

## 2. 核心对象

V1 定义五个核心对象：

- `NormalizedEvent`
- `Claim`
- `Outcome`
- `RecallPacket`
- `ActivationLog`

---

## 3. `NormalizedEvent`

### 3.1 Required fields

```ts
type NormalizedEvent = {
  id: string
  ts: string
  project_id: string
  agent_id: string
  agent_version: string
  event_type: EventType
  content: string
  source_kind?: "user" | "agent" | "system" | "operator" | "imported"
  trust_level?: "low" | "medium" | "high"
}
```

说明：

- `agent_version` 在 V1 视作 required
- 如果无法确定，允许值为 `"unknown"`
- `source_kind` / `trust_level` 用于表达 provenance，不等价于 `event_type`

### 3.2 Optional fields

```ts
type NormalizedEventOptional = {
  session_id?: string
  workspace_id?: string
  repo_id?: string
  parent_event_id?: string
  causation_id?: string
  scope?: EventScope
  metadata?: Record<string, unknown>
}
```

说明：

- `parent_event_id` / `causation_id` 至少出现其一即可，用于事件因果链追踪

### 3.3 EventType

```ts
type EventType =
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
```

### 3.4 EventScope

```ts
type EventScope = {
  repo?: string
  branch?: string
  cwd?: string
  files?: string[]
}
```

### 3.5 Required metadata for command-like events

对于以下事件：

- `command_result`
- `test_result`
- `build_result`
- `lint_result`
- `benchmark_result`

推荐 metadata：

```ts
{
  exit_code: number
  command_name: string
  duration_ms?: number
  touched_files?: string[]
  stdout_digest?: string
  stderr_digest?: string
}
```

---

## 4. `Claim`

### 4.1 Core fields

```ts
type Claim = {
  id: string
  created_at: string
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
  cardinality: "singleton" | "set"
  content: string
  source_event_ids: string[]
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
  pinned?: boolean
  valid_from?: string
  valid_to?: string
  supersedes?: string[]
  last_verified_at?: string
  last_activated_at?: string
  scope?: ClaimScope
}
```

### 4.2 ClaimScope

```ts
type ClaimScope = {
  repo?: string
  branch?: string
  cwd_prefix?: string
  files?: string[]
}
```

### 4.3 Thread extension

```ts
type ThreadClaimExtension = {
  thread_status?: "open" | "resolved" | "blocked"
  resolved_at?: string
  resolution_rules?: Array<
    | { type: "issue_closed"; issue_id: string }
    | { type: "pr_merged"; pr_id: string }
    | { type: "branch_deleted"; branch: string }
    | { type: "commit_contains"; pattern: string }
    | { type: "test_pass"; test_name: string }
  >
}
```

实现说明：

- V1 contract 语义上允许 `thread` 携带扩展字段
- 存储实现可以选择同表 nullable columns，或 extension table

### 4.4 Default values

推荐默认值：

```ts
confidence = 0.5
importance = 0.5
outcome_score = 0.0
verification_status = "unverified"
status = "active"
cardinality = "singleton"
pinned = false
```

### 4.5 Hard constraints

- `source_event_ids.length >= 1`
- `canonical_key` 必须符合 identity contract
- `outcome_score` 范围固定为 `[-1, 1]`
- `confidence`、`importance` 范围固定为 `[0, 1]`

---

## 5. `Outcome`

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

约束：

- `strength` 范围 `[0, 1]`
- `related_event_ids.length >= 1`

---

## 6. `RecallPacket`

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

约束：

- `active_claims` 默认不包含 `superseded` / `archived`
- `open_threads` 默认只包含 `thread_status != resolved`
- 每条入选 claim 必须带 `activation_reasons`

### 6.1 `brief` 生成规则

V1 默认：

- 使用规则生成，不依赖 LLM
- 内容模板：
  - 项目状态一句话
  - 当前 open threads
  - 最近关键 decisions
- 推荐长度：500 tokens 以内

如未来引入 LLM 生成：

- 必须有规则 fallback

---

## 7. `ActivationLog`

```ts
type ActivationLog = {
  id: string
  ts: string
  project_id: string
  claim_id: string
  eligibility_result: "passed" | "filtered"
  suppression_reason?:
    | "project_mismatch"
    | "scope_mismatch"
    | "verification_guard"
    | "superseded"
    | "archived"
    | "expired"
    | "low_rank"
    | "token_budget"
  rank_score?: number
  packing_decision?: "included" | "dropped"
  activation_reasons?: string[]
}
```

目的：

- 解释为什么被召回
- 解释为什么没被召回

### 7.1 写入策略

V1 默认：

- `filtered` 和 `dropped` 必写
- `included` 仅在 debug / audit 模式写
- 写入失败不阻塞 recall 主路径

### 7.2 边界

- `ActivationLog` 只记录 recall / suppression 相关决策
- claim 生命周期迁移必须记录到 `claim_transitions`

---

## 8. Activation 参数 v1

### 8.1 三阶段

1. eligibility filter
2. ranking
3. budget packing

### 8.2 默认 ranking 权重

V1 推荐默认值：

```text
w_s = 0.30   scope_match
w_c = 0.25   confidence
w_p = 0.20   pin_or_verification_bonus
w_r = 0.10   relevance
w_f = 0.10   freshness
w_i = 0.05   importance
w_o = 0.15   outcome_score
```

说明：

- 当前 runtime baseline 已开启轻量 outcome-aware ranking
- `w_o` 保持低值，避免 outcome 稀疏阶段主导排序
- outcome 仍参与 stale 延缓、verification strengthening、benchmark 记录与后续调参

### 8.3 Freshness function

V1 采用指数衰减：

```text
freshness = exp(-lambda * age_days)
```

默认 `lambda`：

| type | lambda |
| --- | ---: |
| `fact` | 0.01 |
| `decision` | 0.02 |
| `thread` | 0.08 |

含义：

- fact 衰减慢
- decision 居中
- thread 衰减快

### 8.4 Eligibility hard filters

- project mismatch
- scope mismatch
- `status == superseded`
- `status == archived`
- `valid_to` expired

---

## 9. Outcome 更新规则 v1

### 9.1 Claim 关联优先级

1. 显式 `related_claim_ids`
2. `related_event_ids -> source_event_ids` 回溯
3. heuristic matching（仅非核心路径）

### 9.2 分数更新

正向 outcome：

```text
new = old + alpha * strength * (1 - old)
```

负向 outcome：

```text
new = old - beta * strength * (old + 1) / 2
```

推荐默认值：

```text
alpha = 0.10
beta  = 0.10
```

### 9.2.1 边界说明

公式假设：

- `outcome_score` 从 `0.0` 起步
- 负值区间的行为是有意设计的
- 对已极差 claim 的继续负向 outcome 影响递减

如果未来需要完全对称行为，应切换到新公式，而不是隐式修改现有行为。

### 9.2.2 极端值示例

| old | 正向 strength=1 | 负向 strength=1 |
| --- | --- | --- |
| 0.0 | +0.10 | -0.05 |
| 0.5 | +0.05 | -0.075 |
| 1.0 | 0 | -0.10 |
| -1.0 | +0.20 | 0 |

### 9.3 正负 outcome 分类

正向：

- `test_pass`
- `build_pass`
- `commit_kept`
- `issue_closed`
- `human_kept`

负向：

- `test_fail`
- `build_fail`
- `commit_reverted`
- `issue_reopened`
- `human_corrected`
- `manual_override`

### 9.4 裁剪

`outcome_score` 最终裁剪到 `[-1, 1]`

---

## 10. SQLite 表建议

V1 最小表集：

- `ledger_events`
- `claims`
- `claim_outcomes`
- `activation_logs`
- `claim_transitions`

### 10.1 `ledger_events`

主键：

- `id`

索引建议：

- `(project_id, ts)`
- `(project_id, event_type, ts)`
- `(causation_id)`

### 10.2 `claims`

索引建议：

- `(project_id, canonical_key)`
- `(project_id, status)`
- `(project_id, type, status)`

### 10.3 `claim_outcomes`

索引建议：

- `(project_id, ts)`
  - `(related_claim_id, ts)`

### 10.4 `claim_transitions`

用途：

- 专门记录状态迁移
- 不与 `activation_logs` 混用

---

## 11. 约束冻结

本文件冻结以下内容：

1. `agent_version` 在 v1 为 required，未知时写 `"unknown"`
2. `thread` 允许扩展专属字段
3. `ActivationLog` 必须同时支持 activation 与 suppression 解释
4. V1 ranking 权重必须有默认值
5. outcome update 必须有显式规则，不能留黑箱
6. `brief` 在 v1 默认使用规则生成
7. `ActivationLog` 与 `claim_transitions` 语义分离

---

## 12. 参考资料

- [identity-and-scope-v1.md](./identity-and-scope-v1.md)
- [state-machine-v1.md](./state-machine-v1.md)
- [Persistent Project Memory Kernel V2](./2026-03-12-project-memory-kernel-design-v2.md)
