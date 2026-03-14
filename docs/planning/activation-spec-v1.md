# Activation Spec v1

**日期：** 2026-03-13  
**状态：** Contract v1  
**作用：** 冻结 candidate generation、eligibility、ranking、budget packing 与 recall 输出边界

---

## 1. 目的

Activation Engine v1 必须回答四个问题：

1. 候选 claim 从哪里来
2. 哪些候选先被过滤掉
3. 剩余候选如何排序
4. 在 token budget 内如何打包成 `RecallPacket`

V1 不允许把 activation 退化成“全表扫 + 任意 top-k 排序”。

---

## 2. 设计原则

- activation 先过滤，再排序，再打包
- candidate set 必须显式定义，不能默认为所有 active claims
- project / scope 过滤优先于 relevance
- packing 必须解决冲突 claim 与预算竞争
- 解释性是 contract，不是 debug 彩蛋

---

## 3. Activation 场景

V1 只定义三类 activation 场景：

1. `session_brief`
2. `project_snapshot`
3. `memory.search`

三者的 candidate 入口不同，不能共用一个模糊的“搜索全库”逻辑。

---

## 4. Candidate Generation

### 4.1 `session_brief`

用于新 session 启动时恢复最近项目状态。

candidate pool 来源：

- 当前 `project_id` 下的 active claims
- 当前 session / workspace 对应 scope 的 active claims
- 未 resolved 的 active / stale threads
- 最近 evidence refs（不直接参与排序，只参与 packet 附带）

不纳入：

- `archived`
- `superseded`
- 已 resolved thread

### 4.2 `project_snapshot`

用于人工或系统请求一个更完整的项目状态视图。

candidate pool 来源：

- 当前 `project_id` 下全部 active claims
- 当前 scope 命中的 stale claims
- 未 resolved threads

### 4.3 `memory.search`

V1 明确：

- 默认搜索 **claims**
- 默认带当前 session scope prefilter
- 显式传 `scope: {}` 才表示 project-wide 搜索

candidate pool 来源：

- 当前 `project_id` 下 active claims
- scope 命中的 stale claims

raw evidence 不属于 `memory.search` 默认返回层。

---

## 5. Eligibility Filter

所有场景先执行硬过滤：

- `project_id` mismatch
- scope mismatch
- `status == superseded`
- `status == archived`
- `valid_to` expired
- `verification_status == disputed` 且未显式请求 debug

额外规则：

- `thread_status == resolved` 不进入 `open_threads`
- stale claim 默认允许进入后续排序，但带惩罚

---

## 6. Relevance 来源

V1 不引入复杂语义检索，relevance 来源分两种：

### 6.1 非搜索场景

对 `session_brief` / `project_snapshot`：

- relevance 由场景规则给出，不是自由文本语义相似

示例：

- 当前 branch 命中的 thread relevance 高
- 当前 cwd_prefix 命中的 fact relevance 高
- pinned decision relevance 高

### 6.2 `memory.search`

对 `memory.search`：

- v1 可采用简单关键词匹配 + scope prefilter
- 暂不要求复杂向量召回

这一步的目的不是“做最强搜索”，而是提供一个可解释、可测的 activation 基线。

---

## 7. Ranking

在 eligibility 通过后，使用 schema 中定义的默认加权模型：

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

### 7.1 默认理解

- `scope_match` 是硬价值维度，不只是微调项
- `w_o = 0.15` 在当前 v1 baseline 中直接参与排序
- outcome 同时影响 claim 生命周期、benchmark 与后续调参

### 7.2 V1 限定

V1 的目标不是做最优排序，而是做：

- 稳定
- 可解释
- 可被 benchmark 驱动调整

---

## 8. Packing

Packing 负责在 token budget 内组装 `RecallPacket`。

### 8.1 Packing 顺序

1. pinned decisions
2. 当前 scope 下的 open threads
3. 当前 scope 下的高 verification facts
4. broader fallback facts
5. recent evidence refs

### 8.2 冲突处理

如果存在同一 `canonical_key` 的多条 claim：

- 优先 most-specific active claim
- broader fallback claim 默认不同时进入 packet
- 如需同时暴露，只在 debug / explain 模式

### 8.3 预算竞争

如果候选过多：

- 优先 drop low-rank broad-scope facts
- 再 drop low-rank stale claims
- open threads 和 pinned decisions 最后被淘汰

---

## 9. RecallPacket 最小组成

### 9.1 `session_brief`

最小组成：

- `brief`
- `active_claims`
- `open_threads`
- `recent_evidence_refs`

### 9.2 `project_snapshot`

最小组成：

- `brief`
- 更宽的 active claims 集合
- `open_threads`
- `warnings`

### 9.3 `memory.search`

最小返回：

- matched claims
- scope
- verification summary
- activation reasons

---

## 10. Explainability

V1 强制要求：

- 入选 claim 必须有 `activation_reasons`
- 未入选 claim 必须可记录 `suppression_reason`

推荐的 suppression reasons：

- `project_mismatch`
- `scope_mismatch`
- `verification_guard`
- `superseded`
- `archived`
- `expired`
- `low_rank`
- `token_budget`

---

## 11. V1 价值证明边界

Phase 1 不宣称“恢复所有关键项目知识”。

V1 只证明三类能力：

1. **结构化 operational memory 能稳定恢复**
   - repo facts
   - branch / issue / failing test threads

2. **显式确认过的局部决策能恢复**
   - 例如来自 `user_confirmation`

3. **被否定旧方案不会继续稳定召回**
   - 例如由 `commit_reverted` / `manual_override` 驱动

这比笼统宣称“恢复关键决策”更真实，也更可测。

---

## 12. 冻结的决策

1. candidate set 必须按场景显式定义
2. `memory.search` 默认不搜索 raw evidence
3. packing 必须解决同 key 冲突与预算竞争
4. explainability 是 contract，不是可选项
5. V1 先做 activation baseline，不做最强 retrieval

---

## 13. 参考资料

- [schema-v1.md](./schema-v1.md)
- [identity-and-scope-v1.md](./identity-and-scope-v1.md)
- [phase-1-implementation-plan.md](./phase-1-implementation-plan.md)
