# Claim Family Registry v1

**日期：** 2026-03-13  
**状态：** Contract v1  
**作用：** 冻结 V1 claim family 的命名、默认语义、deterministic 入口和 lifecycle 约束

---

## 1. 目的

`fact / decision / thread` 只是顶层类型，还不足以指导 compiler 实现。

V1 需要更细一层的 family registry，用来明确：

- 哪些 family 已进入 Phase 1 主路径
- 每个 family 的 `canonical_key` 形状
- 默认 `cardinality`
- 默认 scope
- 默认 verification / outcome / resolution 规则

---

## 2. 设计原则

1. family 必须能映射到稳定的 `canonical_key`
2. family 默认走 deterministic 或 hint-driven deterministic path
3. V1 不依赖自由文本 LLM 命名 family
4. family 先服务于 session recovery，而不是知识库覆盖率

---

## 3. 注册表

| family | `canonical_key` pattern | type | cardinality | Phase 1 状态 | deterministic 入口 | 默认 recall 角色 |
| --- | --- | --- | --- | --- | --- | --- |
| `repo.package_manager` | `repo.package_manager` | `fact` | `singleton` | implemented | content / metadata extractor | active claim |
| `repo.test_framework` | `repo.test_framework` | `fact` | `singleton` | implemented | content / metadata extractor | active claim |
| `repo.build_command` | `repo.build_command` | `fact` | `singleton` | implemented | content / metadata extractor | active claim |
| `repo.default_branch` | `repo.default_branch` | `fact` | `singleton` | implemented | metadata extractor | active claim |
| `decision.confirmed` | `decision.<slot>` | `decision` | `singleton` | implemented | `user_confirmation` | active claim |
| `decision.avoid` | `decision.avoid.<slot>` | `decision` | `singleton` | implemented | `manual_override` / `git_revert` | active claim |
| `decision.current_strategy` | `decision.current_strategy.<slot>` | `decision` | `singleton` | implemented | `memory_hints.family_hint=current_strategy` | active claim |
| `decision.rejected_strategy` | `decision.rejected_strategy.<slot>` | `decision` | `singleton` | implemented | `memory_hints.family_hint=rejected_strategy` | active claim |
| `thread.issue` | `thread.issue.<id>` | `thread` | `singleton` | implemented | issue id extractor | open thread |
| `thread.test` | `thread.test.<slug>` | `thread` | `singleton` | implemented | failing test extractor | open thread |
| `thread.branch` | `thread.branch.<slug>` | `thread` | `singleton` | implemented | branch naming rule | open thread |
| `thread.blocker` | `thread.blocker.<slot>` | `thread` | `singleton` | implemented | `memory_hints.family_hint=blocker` | open thread |
| `thread.open_question` | `thread.open_question.<slot>` | `thread` | `singleton` | implemented | `memory_hints.family_hint=open_question` | open thread |

---

## 4. Family 级默认规则

### 4.1 Repo facts

- project-wide scope 为默认
- `verification_status` 默认 `system_verified`
- 允许被同 scope 的新 fact supersede

### 4.2 Explicit / strategy decisions

- `decision.confirmed` 与 `decision.current_strategy` 默认进入 `session_brief`
- `decision.rejected_strategy` 与 `decision.avoid` 默认不应在负向 outcome 下自我 stale
- `decision.current_strategy.*` 主要表达“当前推荐路线”
- `decision.rejected_strategy.*` 主要表达“已明确否定但不一定有 rollback evidence 的路线”

### 4.3 Operational threads

- `thread.issue.*`
  - resolution rule 默认可被 `issue_closed` 驱动
- `thread.test.*`
  - resolution rule 默认可被匹配的 `test_pass` 驱动
- `thread.branch.*`
  - 默认无自动 resolution rule，除非后续引入 branch deletion signal
- `thread.blocker.*`
  - 表达当前阻塞项
- `thread.open_question.*`
  - 表达尚未回答的问题，不等同于 blocker

---

## 5. Hint-driven deterministic 规范

V1 允许 adapter 或 transcript ingest 提供：

```ts
metadata.memory_hints = {
  family_hint?: "current_strategy" | "blocker" | "rejected_strategy" | "open_question"
  canonical_key_hint?: string
  scope_hint?: ClaimScope
}
```

解释：

- `family_hint` 只负责把事件路由到 family
- `canonical_key_hint` 表达 family 内的稳定 slot
- compiler 负责最终 key 组装
- `family_hint` 不是 claim 直写后门
- `manual_override` / `git_revert` 的 negative-memory decision 必须绑定稳定 target slot
- 缺少 `overrides_canonical_key` 或等价稳定 key 时，只记录 outcome，不铸造 `decision.avoid.*`

V1 额外要求受控 capture path：

```ts
capture_path?:
  | "fixture.user_confirmation"
  | "fixture.user_message"
  | "claude_code.hook.user_confirmation"
  | "claude_code.hook.user_message"
  | "import.transcript"
  | "system.tool_observation"
  | "operator.manual"
```

解释：

- runtime 不再把 `source_kind` / `trust_level` 当作高价值 family 的自由上传信任输入
- `source_kind` / `trust_level` 由 runtime 基于 `capture_path` 归一化
- 是否接受 `family_hint`，由 `capture_path + event_type` 共同决定
- 缺少可信 `capture_path` 的 hint 不产出 family claim
- 默认 runtime allowlist 不直接开放正式 adapter capture path；`claude_code.hook.*` 仅用于严格受控的 reference adapter spike

V1 事件类型限制：

- `decision.current_strategy`
  - 仅允许 `user_confirmation`
- `decision.rejected_strategy`
  - 仅允许 `user_confirmation`
- `thread.blocker`
  - 仅允许 trusted `capture_path` 下的 `user_message` / `user_confirmation`
- `thread.open_question`
  - 仅允许 trusted `capture_path` 下的 `user_message` / `user_confirmation`

热路径规则：

- trusted `user_confirmation capture_path` 可直接进入 active / `user_confirmed` 路径
- `user_message` 产出的 `thread.blocker` / `thread.open_question` 默认仅作为低信任 candidate
- 这类 candidate 需要显式 verify 或额外证据后，才应进入 `session_brief`

示例：

```ts
metadata.memory_hints = {
  family_hint: "current_strategy",
  canonical_key_hint: "windows.install"
}
```

会生成：

```text
decision.current_strategy.windows.install
```

---

## 6. V1 明确不进入主路径的 family

以下 family 暂不进入 Phase 1 主路径：

- `repo.owners`
- `workflow.allowed_commands`
- `decision.preference.*`
- `thread.dependency.*`
- `fact.subproject.*`

原因：

- 需要 `set` cardinality 或更复杂 scope 规则
- 容易先把 compiler 和 recall 复杂度拉爆

---

## 7. 实施要求

1. compiler 新增 family 时，先更新本注册表
2. family 若改变 `canonical_key` pattern，必须同步更新：
   - `compiler-and-ingestion-v1.md`
   - `schema-v1.md`
   - benchmark fixtures
3. family 若进入 `session_brief` 热路径，必须补 runtime-only benchmark 或 smoke test

---

## 8. 冻结的决策

1. V1 family registry 先偏少，不追求覆盖面
2. 高价值 family 优先于通用知识 family
3. hint-driven deterministic 比自由文本提取更优先
4. 每个新增 family 都必须对应可解释的 lifecycle 语义
