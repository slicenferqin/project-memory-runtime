# Evaluation Protocol v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 memory runtime 的 benchmark、评估流程与最小验收口径

---

## 1. 目的

V1 明确：

- 不用单一检索命中率评价系统
- 要用 session 恢复、stale 抑制、outcome 学习、多 agent 一致性来评价

---

## 2. 评估原则

- 评估对象是 runtime 行为，不是单个 LLM 表现
- 优先测系统是否稳定、可解释、可复现
- benchmark 必须可自动重放
- 每个 benchmark 至少有一个成功门槛

---

## 3. Benchmark 套件

V1 定义四组 benchmark：

1. Session Recovery Benchmark
2. Stale Suppression Benchmark
3. Outcome Learning Benchmark
4. Multi-agent Consistency Benchmark

---

## 4. Session Recovery Benchmark

### 4.1 目标

验证新 session 在只有 `RecallPacket` 的情况下，能否恢复：

- 当前项目状态
- 当前分支重点
- 未完成线程
- 关键决策

### 4.2 输入

- 历史 `ledger_events`
- 已编译 `claims`
- 目标 session 的 `RecallPacket`

### 4.2.1 Ground truth

Session recovery benchmark 的标准答案应来自以下二选一：

- 人工标注的 gold snapshot
- 由冻结 claims + active threads 生成的 gold answer

### 4.3 任务

让一个新 agent 执行：

- 描述当前项目在做什么
- 说出当前最重要的 open threads
- 说出不应重复尝试的旧方案

### 4.4 评估指标

- session 恢复成功率
- 重复追问减少率
- open thread 恢复率

### 4.5 v1 通过线

- open thread 恢复率 >= 0.8
- 重复提问率相对 baseline 降低 >= 30%

---

## 5. Stale Suppression Benchmark

### 5.1 目标

验证系统不会稳定召回已失效、已 superseded 的旧记忆。

### 5.2 数据构造

- 构造一组已 superseded 的 decisions
- 构造一组 stale 但未完全错误的 facts
- 构造一组当前 active 的替代 claims

### 5.3 检查项

- superseded claims 是否被过滤
- stale claims 是否被明显降权
- active 替代 claims 是否排在前面

### 5.4 指标

- stale recall rate
- superseded claim leakage
- active replacement precision

### 5.5 v1 通过线

- superseded leakage <= 5%
- stale recall rate 在存在 active replacement 时应为 0

---

## 6. Outcome Learning Benchmark

### 6.1 目标

验证 outcome signals 能否逐步改变记忆排序。

### 6.2 数据构造

给多条候选策略：

- 一部分具备 `test_pass + commit_kept`
- 一部分具备 `commit_reverted`
- 一部分没有结果信号

### 6.3 检查项

- 正向 outcome 是否提升 rank
- 负向 outcome 是否降低 rank
- 无结果信号的 claim 是否不会永远被压死

### 6.4 指标

- outcome-backed recall ratio
- successful strategy promotion rate
- reverted strategy demotion rate

### 6.5 v1 通过线

- 正向策略在重复 round 中平均 rank 上升
- 负向策略在重复 round 中平均 rank 下降

### 6.6 轮次要求

- 每个 outcome learning benchmark 至少执行 3 轮
- 推荐 5 轮，以观察 rank 变化趋势

---

## 7. Multi-agent Consistency Benchmark

### 7.1 目标

验证多个 agent 在共享同一 `project_id` 时是否得到一致项目状态。

### 7.2 场景

- Agent A 写入 evidence
- runtime 编译 claims
- Agent B 新开 session 读取 recall

### 7.3 检查项

- 是否识别同一项目
- 是否看到相同 active decisions
- 是否恢复相同 open threads

### 7.4 指标

- multi-agent state consistency
- open thread divergence rate
- decision mismatch rate

### 7.5 v1 通过线

- active decision mismatch <= 5%
- open thread divergence <= 10%

### 7.6 必测场景

- 同 repo 不同 clone
- 同 repo 不同 worktree
- 同 monorepo 不同 subproject

当前实现说明：

- runtime-only harness 可以先验证 shared-db / shared-project-id 一致性
- clone / worktree / subproject 场景在 adapter 前仍需补专门 fixture 或集成套件

---

## 8. 解释性评估

V1 额外评估系统可解释性。

### 8.1 检查项

- 被召回 claim 是否有 `activation_reasons`
- 被压制 claim 是否能在 `ActivationLog` 找到原因
- 是否能追溯到 evidence refs

### 8.2 通过线

- RecallPacket 中 100% claim 带 `activation_reasons`
- suppression 样本中 >= 90% 可追踪到 `suppression_reason`

---

## 9. 基线对照

V1 评估必须至少保留两个 baseline：

1. keyword/vector top-k baseline
2. no-memory baseline

比较目标：

- 本系统是否优于简单检索
- 本系统是否优于无记忆运行

### 9.1 运行方式

- baseline 通过 runtime flag 切换
- 不要求独立部署
- benchmark 输出应包含与 baseline 的 delta 对比列

---

## 10. 数据集要求

V1 benchmark 数据集至少包含：

- 单仓库项目
- 多分支 hotfix 场景
- monorepo 子项目
- 人工 override 场景
- supersede / stale 场景

并应包含：

- 正向 outcome
- 负向 outcome
- 无 outcome 样本

---

## 11. 运行方式

每个 benchmark 应支持：

- deterministic replay
- runtime-only evaluation
- adapter-integrated evaluation

V1 建议输出：

- JSON 结果
- Markdown 摘要

runtime-only benchmark 约束：

- 优先通过 `ledger_events -> compiler -> outcome link -> recall` 主闭环重放
- 不得使用 admin/operator bypass 伪造核心语义
- admin/operator 入口仅允许出现在独立 operator-integrated 套件
- 若输出 delta，必须显式运行 baseline
- outcome benchmark 应额外记录 memory growth / packet pollution 指标

---

## 12. 失败分析要求

每次 benchmark 失败至少记录：

- 失败 claim / recall packet
- activation reasons
- suppression reason
- related evidence refs
- scope 信息
- agent / adapter version

---

## 13. 冻结的决策

1. V1 评价对象是 runtime 行为，而不是模型主观表现
2. 必须保留 no-memory 与 simple-search baseline
3. 可解释性本身是 V1 的验收项之一
4. Benchmark 要覆盖 stale、outcome、多 agent、一致性

---

## 14. 参考资料

- [schema-v1.md](./schema-v1.md)
- [Persistent Project Memory Kernel V2](./2026-03-12-project-memory-kernel-design-v2.md)
