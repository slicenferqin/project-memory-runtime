# Compiler And Ingestion v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 event ingestion、deterministic extraction、claim/outcome 编译、stale sweep 与日志写入边界

---

## 1. 目的

这份文档回答：

- event 如何进入 runtime
- compiler 何时触发
- 哪些 claim / outcome 由规则提取
- `canonical_key` 何时生成
- stale / supersede / outcome linking 何时执行

---

## 2. 设计原则

- evidence 先写入，再编译 claim
- compiler 拥有 claim 生成权，不由 adapter 直接写 claim
- deterministic extraction 优先
- LLM 只作为受控增强层
- 编译流程必须幂等

---

## 3. Ingestion Pipeline

标准流程：

1. adapter 捕获原始生命周期信号
2. adapter 生成 `NormalizedEvent`
3. runtime 执行 idempotent write 到 `ledger_events`
4. compiler 根据事件类型选择：
   - 即时增量编译
   - 批处理编译
5. compiler 产出：
   - claims
   - outcomes
   - transitions
6. recall 端按需构建 `RecallPacket`

---

## 4. Ingestion 幂等规则

### 4.1 Primary idempotency key

- 以 `event.id` 作为 primary idempotency key
- runtime 对重复 `event.id` 写入视为 no-op

### 4.2 Content-level dedupe

V1 不要求 runtime 对“内容相同但 id 不同”的事件做强去重。

允许的最小规则：

- 同一 adapter 在短时间窗口内的完全重复事件，可选做轻量内容 hash 去重
- 跨 agent 内容级合并不作为 v1 必须能力

---

## 5. Compiler Trigger Model

### 5.1 即时增量编译

以下事件默认触发即时编译：

- `user_confirmation`
- `test_result`
- `build_result`
- `git_commit`
- `git_revert`
- `issue_closed`
- `issue_reopened`
- `manual_override`
- `human_edit_after_agent`

### 5.2 生命周期触发

以下生命周期节点触发“事件批量收口 + 增量编译”：

- session end / idle
- pre-compact
- post-tool-use after important actions

### 5.3 定时维护

cron 负责：

- stale review
- archive sweep
- backfill recompilation
- integrity checks

---

## 6. Deterministic Extractors v1

V1 必须提供规则提取器，用于以下主题：

### 6.1 Fact extractors

- `repo.package_manager`
- `repo.test_framework`
- `repo.build_command`
- `repo.default_branch`

### 6.2 Thread extractors

- `thread.issue.<id>`
- 当前 failing test thread
- 当前 hotfix branch thread

### 6.3 Outcome extractors

- `test_pass` / `test_fail`
- `build_pass` / `build_fail`
- `commit_reverted`
- `issue_closed` / `issue_reopened`
- `human_kept` / `human_corrected`

原则：

- 没有 deterministic baseline 的 claim 不进入 MVP 核心闭环

---

## 7. `canonical_key` 生成流程

### 7.1 生成顺序

1. deterministic rule
2. adapter hint
3. controlled compiler inference

### 7.2 禁止行为

- adapter 直接写最终 claim
- LLM 在无规则约束下自由创造长期 key

### 7.3 冲突处理

compiler 在生成 key 后必须检查：

- 是否已有相同 `project_id + canonical_key`
- `cardinality` 是否允许并存
- scope 是否兼容
- 是否需要 supersede / stale / conflict hold

---

## 8. Outcome Linking

### 8.1 关联优先级

1. 显式 `related_claim_ids`
2. `related_event_ids -> source_event_ids`
3. heuristic fallback

### 8.2 更新时机

outcome 一旦写入并完成 linking，应立即更新：

- `Claim.outcome_score`
- 必要时触发 `active -> stale`
- 必要时写入 `claim_transitions`

---

## 9. Stale Sweep

### 9.1 TTL 起点

stale TTL 起点定义为：

```text
ttl_anchor = last_verified_at ?? created_at
```

V1 明确：

- `last_activated_at` 不延长 stale TTL
- recall 命中不能被当作验证

### 9.2 Sweep 行为

stale sweep 只负责：

- 检查 TTL
- 检查已知冲突事件
- 更新 `active -> stale`

不负责：

- 直接 archive 全量 claim
- 重新生成 RecallPacket

---

## 10. Claim Transition 责任边界

### 10.1 `claim_transitions`

`claim_transitions` 专门记录：

- 状态迁移
- 迁移原因
- 触发者

### 10.2 `activation_logs`

`activation_logs` 只记录：

- recall eligibility
- ranking
- packing
- suppression

两者不混用。

---

## 11. `ActivationLog` 写入策略

V1 默认策略：

- 默认写 `filtered` 与 `dropped`
- `included` 只在 debug / audit 模式下写
- 写入失败不阻塞 recall 主路径

目的：

- 保留 suppression 可解释性
- 控制日志爆炸

---

## 12. `brief` 生成规则

V1 默认：

- 使用规则生成，不依赖 LLM
- 模板来源：
  - 项目状态一句话
  - 当前 open threads
  - 最近关键 decisions

推荐上限：

- 500 tokens 以内

如果未来引入 LLM 生成：

- 必须有规则 fallback

---

## 13. Trigger Ownership Matrix

| 动作 | compiler | adapter | memoryctl | user confirmation |
| --- | --- | --- | --- | --- |
| 写入 event | ✅ | ✅ | ✅ | ❌ |
| 生成 claim | ✅ | ❌ | ❌ | ❌ |
| 生成 canonical key | ✅ | hint only | ❌ | ❌ |
| `active -> stale` | ✅ | ❌ | ✅ | ❌ |
| `active -> superseded` | ✅ | ❌ | ✅ | 视 claim type |
| `stale -> active` | ✅ via re-verify | ❌ | ✅ | 视情况 |
| `archived -> active` | ❌ | ❌ | ✅ | ✅ |

---

## 14. 冻结的决策

1. compiler 是 claim 生成的唯一权威
2. adapter 只能写 event，不能直接写 claim
3. `last_activated_at` 不延长 stale TTL
4. `ActivationLog` 与 `claim_transitions` 语义分离
5. `brief` 在 v1 默认采用规则生成

---

## 15. 参考资料

- [identity-and-scope-v1.md](./identity-and-scope-v1.md)
- [state-machine-v1.md](./state-machine-v1.md)
- [schema-v1.md](./schema-v1.md)
- [adapter-contract-v1.md](./adapter-contract-v1.md)
