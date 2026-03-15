# State Machine v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 Claim 生命周期、自动迁移规则、thread 扩展状态与 stale 触发条件

---

## 1. 目的

这份文档定义：

- Claim 的通用状态机
- `fact / decision / thread` 的差异化语义
- 自动与人工迁移边界
- stale TTL 与触发条件

---

## 2. 通用状态

所有 Claim 都具备通用状态：

- `active`
- `stale`
- `superseded`
- `archived`

### 2.1 含义

- `active`
  当前可参与 recall

- `stale`
  可能过时，默认降权，但不等于错误

- `superseded`
  被更高优先级或更新版本的 claim 覆盖，默认不参与 recall

- `archived`
  保留审计证据，不参与热路径

---

## 3. 基础状态迁移

允许的基础迁移：

```text
active -> stale
active -> superseded
active -> archived
stale -> active
stale -> superseded
stale -> archived
superseded -> archived
archived -> active
```

### 3.1 迁移限制

- `archived -> active` 只能通过显式 restore 或 re-verification
- pinned claim 的状态迁移需要更高门槛
- 高影响 `decision` 的 supersede 需要人工确认或强验证

高影响 `decision` 的最小判定来源：

- `pinned == true`
- `canonical_key` 命中高风险前缀，如 `decision.security.*`、`decision.deploy.*`
- 配置层显式声明 `high_impact = true`

---

## 4. Claim Type 语义差异

虽然三类 claim 共用基础状态，但其生命周期语义不同。

### 4.1 `fact`

特点：

- 更接近当前真值陈述
- 容易被系统验证
- 被更新时通常自然进入 `superseded`

### 4.2 `decision`

特点：

- 是项目历史中的约束或选择
- 不一定常变，但变化代价高
- 被替换时通常需要更高置信度或人工确认

### 4.3 `thread`

特点：

- 更像待完成工作项
- 关闭不等于“被覆盖”
- 更需要 machine-resolvable resolution

因此，`thread` 在通用状态之外，增加专属字段：

```ts
type ThreadStatus = "open" | "resolved" | "blocked"
```

说明：

- `thread_status` 是 thread 专属扩展
- `status` 仍表示是否参与 recall 与长期生命周期

---

## 5. `thread` 的双层状态

### 5.1 为什么要双层状态

如果只用通用状态机描述 thread，会出现语义混乱：

- thread 完成后，不一定叫 `superseded`
- thread 阻塞后，不一定该 `archived`

所以 V1 明确：

- `status`：通用 lifecycle
- `thread_status`：工作项语义

### 5.2 推荐组合

常见组合：

- `status=active`, `thread_status=open`
- `status=active`, `thread_status=blocked`
- `status=stale`, `thread_status=open`
- `status=archived`, `thread_status=resolved`

### 5.3 thread 完成规则

当满足 `resolution_rules` 时：

- `thread_status` 先变为 `resolved`
- `resolved_at` 应被记录
- `status` 默认从 `active -> archived`

原因：

- 完成后的 thread 保留历史价值
- 但不应继续进入 recall 热路径

如果未来需要“已完成线程的短期回顾”，可以通过 recent outcome 或 evidence refs 完成，而不是保持其为 `active`

---

## 6. 自动迁移规则

### 6.1 `active -> superseded`

触发条件：

- 同一 `project_id`
- 同一 `canonical_key`
- `cardinality == singleton`
- scope 兼容
- 新 claim 通过验证门槛

适用类型：

- `fact`
- `decision`

`thread` 默认不走这条路径，除非明确是替代线程。

### 6.2 `active -> stale`

触发条件分为两类：

#### 时间触发

推荐 v1 默认 TTL：

| type | stale TTL |
| --- | --- |
| `fact` | 90 天无验证 |
| `decision` | 60 天无验证 |
| `thread` | 14 天无 resolution signal |

TTL 起点定义为：

```text
ttl_anchor = last_verified_at ?? created_at
```

V1 明确：

- `last_activated_at` 不延长 stale TTL
- recall 命中不算验证

#### 事件触发

- 出现 conflicting evidence，但不足以立即 supersede
- 关联 branch 被删除，但 thread 未明确关闭
- 与当前 repo structure 明显不一致

### 6.3 `stale -> active`

触发条件：

- 新 evidence 再次验证
- 用户确认仍然有效
- 系统验证成功

### 6.6 迁移触发者矩阵

| 迁移方向 | compiler 自动触发 | adapter 请求 | memoryctl 触发 | 需要用户确认 |
| --- | --- | --- | --- | --- |
| `active -> stale` | ✅ | ❌ | ✅ | ❌ |
| `active -> superseded` | ✅（低影响 fact） | ❌ | ✅ | ✅（高影响 decision） |
| `stale -> active` | ✅（via re-verify） | ❌ | ✅ | 视 verification_status |
| `active/stale -> archived` | ✅ | ❌ | ✅ | 视 claim type |
| `archived -> active` | ❌ | ❌ | ✅ | ✅ |

### 6.4 `active/stale -> archived`

触发条件：

- thread 已 resolved
- 明确错误但需保留审计痕迹
- 长期不再需要热路径访问

### 6.5 `archived -> active`

必须满足其一：

- explicit restore
- re-verification
- 用户显式解除归档

---

## 7. 人工确认边界

以下迁移建议要求人工确认或高置信自动化：

- `decision.active -> superseded`
- pinned claim 的任意状态迁移
- `archived -> active`
- 高风险 thread 的 `resolved`

高风险示例：

- 安全策略
- 部署流程
- 关键生产事故

---

## 8. Verification 与状态的关系

### 8.1 verification 对 status 的影响

- `system_verified` / `user_confirmed` 更不容易进入 `stale`
- `disputed` 的 claim 不应保持 `active`
- `unverified` 的 claim 如果长期无 outcome，应更容易 stale

### 8.2 推荐策略

- `verification_status == disputed`：
  - 默认 `status = stale`
  - 仅在显式人工处理后恢复

- `verification_status == outcome_verified`：
  - 可获得 stale TTL 延长

---

## 9. Outcome 与状态迁移

正向 outcome 不直接改状态，但会：

- 提高 `outcome_score`
- 延缓 stale
- 提高 activation ranking

负向 outcome 可能触发：

- `active -> stale`
- `stale -> archived`

示例：

- `commit_reverted`
- `manual_override`
- `human_corrected`

额外约束：

- `manual_override` / `human_corrected` 对应的原始事件只有来自 trusted negative-lifecycle `capture_path` 时，才允许真正驱动 `active -> stale` 或负向记忆生成
- 缺少可信 `capture_path` 时，事件可以保留在 ledger 中，但不得直接改写 claim lifecycle

---

## 10. 状态机与 recall 的关系

默认 recall 规则：

- `active`：可参与 recall
- `stale`：可参与 recall，但默认降权
- `superseded`：默认过滤
- `archived`：默认过滤

对 thread：

- `thread_status == resolved`：默认不进入 `open_threads`
- `thread_status == blocked`：可以进入 `open_threads`，但需明显标注

---

## 11. 审计要求

所有状态迁移都应记录：

- `claim_id`
- `from_status`
- `to_status`
- `reason`
- `trigger_type`
- `trigger_ref`
- `actor`
- `ts`

V1 冻结为：

- `activation_logs`：只记录 recall / ranking / packing / suppression
- `claim_transitions`：专门记录状态迁移审计

---

## 12. 冻结的决策

本文件冻结以下决策：

1. `fact / decision / thread` 共用基础状态机
2. `thread` 增加专属 `thread_status`
3. `thread` 完成默认归档，而不是留在 active
4. stale 默认由“时间 TTL + 事件触发”共同决定
5. 高影响 decision 的 supersede 默认不是纯自动行为
6. stale TTL 起点为 `last_verified_at ?? created_at`
7. `last_activated_at` 不延长 stale TTL

---

## 13. 待后续文档承接

后续由其他文档继续细化：

- `schema-v1.md`
  - 字段约束
  - 默认值

- `evaluation-protocol-v1.md`
  - stale suppression benchmark

- `adapter-contract-v1.md`
  - 谁负责触发状态迁移

---

## 14. 参考资料

- [Persistent Project Memory Kernel V2](./2026-03-12-project-memory-kernel-design-v2.md)
- [2026-03-12-design-v2-claude-review.md](../reviews/2026-03-12-design-v2-claude-review.md)
- [2026-03-12-design-v2-gpt-review.md](../reviews/2026-03-12-design-v2-gpt-review.md)
