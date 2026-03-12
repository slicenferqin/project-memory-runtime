

### **V2 比 V1 明显更成熟，已经从“方向稿”进化成了“接近可开工的实现规范”；现在最大的短板不再是战略，而是还缺少少数几个会直接影响实现稳定性的精确定义。**

这版我会给更高评价。相比 V1，V2 最大的进步不是多写了内容，而是你成功把几个关键抽象真正“落地化”了：

- 把主交付物从 MCP server 改成 runtime
- 把接入策略从 tool-first 改成 lifecycle-first
- 把 claim contract、outcome contract、recall contract 分开
- 把 activation 从乘法口号改成三阶段 pipeline
- 把迁移计划、benchmark、deterministic baseline 都补上了

这意味着 V2 已经不只是“说服别人为什么这方向对”，而是在开始回答“团队应该按什么边界开工”。

## **总体判断**

如果 V1 是一份优秀的产品/架构方向稿，那 V2 已经是一份合格的 implementation planning draft。方向上我基本认同，而且你吸收评审意见的质量很高，不是简单拼贴，而是把建议收敛成了更一致的内核逻辑。

我现在对这份 V2 的总体评价是：

| 维度 | 评价 |
|---|---|
| 方向清晰度 | 9.5/10 |
| 产品聚焦度 | 9/10 |
| 架构边界清晰度 | 9/10 |
| 数据契约成熟度 | 8.5/10 |
| 可迁移性设计 | 8.5/10 |
| MVP 可落地性 | 8.5/10 |
| 实现前仍需补齐的细节 | 7.5/10 |

换句话说，这版已经足够支撑“进入 schema / state machine / adapter spec 细化阶段”。

## **V2 最明显的提升在哪里**

### **1. 你终于把“产品是什么”说清楚了**

“主交付物是 runtime，而不是 MCP/CLI” 这一句，非常重要。

这解决了一个常见问题：很多项目明明真正想做的是“状态系统”，结果因为最早的交付形态是 MCP server，就慢慢把自己做成了工具集合。你在 V2 里把 runtime 放到中心，把 MCP 降成 optional bridge，把 CLI 降成运维面，这个重心摆正了。

这会直接影响后续很多决策：

- 数据模型会围绕 lifecycle，而不是围绕 tool I/O
- adapter 会围绕 capture/inject，而不是围绕命令式调用
- recall packet 会成为产品接口，而不是内部副产物

这一步很关键，而且是正确的。

### **2. Lifecycle-first 比 tool-first 更符合真实 agent 场景**

这也是 V2 的一个核心升级。

你明确写出：

- hooks/plugins 是主 capture 与 recall 路径
- sidecar/transcript ingest 是过渡方案
- CLI 是人工接口
- MCP 是兼容桥

这个排序很有现实感。因为 coding agent 是否能稳定“记得自己调用工具”，本来就不应该成为记忆系统成立的前提。只要能通过 session lifecycle、tool observation、issue/PR 状态变化等被动信号捕获事件，系统可靠性就会高很多。

这点和你要做的“全生命周期 memory runtime”是高度一致的。

### **3. Claim contract 收敛得更好了**

V1 的 claim taxonomy 有点多，V2 把对外 type 收成 `fact / decision / thread`，这是好决定。

这样做有三个好处：

第一，减少 v1 策略矩阵复杂度。  
第二，更容易定义 verification 和 transition。  
第三，更利于先做 deterministic baseline。

同时，你保留 `assertion_kind`、`canonical_key`、`verification_status`，这说明你没有为了简化而把关键表达力砍掉。这种“外部 contract 收敛，内部语义保留”的处理很成熟。

### **4. `RecallPacket` 升成一等接口是很对的**

这是 V2 里我最认可的一个决策之一。

很多 memory 系统最大的问题不是存不住，而是“取出来后缺乏标准形态”。你现在把 `RecallPacket` 明确成：

- agent 之间的公共语言
- 人类调试的最小可解释单元
- recall 质量评估的核心输出

这会让整个系统更稳定，因为它强迫 runtime 不只是会检索，还要会打包、解释、压缩、排序。

从产品角度说，真正被 agent 消费的，不是 claims table，而是 recall packet。你把这一层抬起来，是对的。

## **我认为 V2 目前最强的三处**

### **一是 evidence-first 原则终于贯穿全篇了**

这版比 V1 更一致。现在从 event、claim、outcome、tool surface 到 migration，基本都围绕：

> evidence 是 source of truth

这比很多记忆项目更扎实，因为它自然带来了：

- 可追溯性
- 可重编译性
- 可审计性
- 可迁移性

只要 evidence ledger 在，claim compiler 和 activation policy 都还能迭代；如果一开始就把“当前记忆文本”当 truth model，后面很难翻身。

### **二是 deterministic extraction baseline 非常关键**

这部分我很认可。你明确提出：

- repo facts 用规则
- thread candidates 用规则
- outcome records 用规则
- 没有 deterministic baseline 的 claim 不进入 MVP 核心闭环

这是一种很健康的工程选择。因为如果 MVP 从第一天开始就严重依赖 LLM 做 claim 编译，后面你很难解释 recall 为什么好或不好，也很难建立 benchmark。

这版在工程取舍上明显更稳了。

### **三是迁移计划终于像“迁移”而不是“重写”**

V2 的三阶段迁移设计已经很像能执行的 plan 了：

- 旁路写入新内核
- 旧 recall API 代理到 activation engine
- 旧 Markdown truth model 降级

这是对的。它能降低仓库演化风险，也更容易让现有使用方式逐步兼容。

## **我认为 V2 还需要补的关键点**

现在不是大改，而是补几个“最后 15% 的精确定义”。这些点不补，进入实现后容易产生歧义。

## **1. `canonical_key` 还需要命名规范**

你已经引入 `canonical_key`，这是对的，但目前缺“如何命名”。

这会直接影响：

- conflict detection
- supersede 判定
- merge 策略
- recall 聚合

如果没有规范，不同 compiler/adapter 很快会生成风格不一致的 key，导致同一事实无法稳定归并。

我建议你在后续 `schema-v1.md` 里明确：

```ts
canonical_key := <domain>.<entity>.<attribute>[.<qualifier>]
```

例如：

- `repo.package_manager`
- `repo.test_framework`
- `branch.hotfix.priority`
- `decision.auth.strategy`
- `thread.issue.1234`
- `workflow.commit.message_style`

同时补三条规则：

- key 必须稳定，不随 wording 改变
- key 应优先表达“同一主题槽位”，而不是完整句子
- key 冲突策略必须定义“同 key 是否天然互斥”

尤其最后一条很重要：不是所有同 key claim 都一定要 supersede。有些 key 是“单值槽位”，有些是“多值集合”。

所以你最好再加一个字段或内置规则：

- `cardinality: singleton | set`

否则后面 `canonical_key` 会被误用。

## **2. `thread` 的关闭条件还可以再严谨一点**

你已经加了 `resolution_condition`，很好，但现在仍然偏“字段列举”，还不够像统一机制。

建议把它抽象成更通用的形式，比如：

```ts
resolution_rules: Array<
  | { type: "issue_closed"; issue_id: string }
  | { type: "pr_merged"; pr_id: string }
  | { type: "branch_deleted"; branch: string }
  | { type: "commit_contains"; pattern: string }
>
```

这样比 `by_issue_close / by_pr_merge / by_branch_delete / by_commit_contains` 更容易扩展和统一处理。

另外建议明确：

- thread 关闭不等于 claim archived
- thread 关闭后是 `superseded`、`archived` 还是保留 `active=false` 的完成态？

现在 `thread` 的“resolved”语义还隐含在状态机之外。这个点最好单独说明，否则实现时会有人争论：关闭线程到底是 `superseded` 还是 `archived`，还是另加 `resolved_at`。

我的建议是不要强行拿四个通用状态兼容线程完成态，最好补一个线程专属字段：

- `thread_status: open | resolved | blocked`

这样更自然。  
因为 `thread` 和 `fact/decision` 在生命周期上不是完全同类。

## **3. Outcome 到 Claim 的映射规则还缺**

你定义了 `Outcome`，很好，但还没回答：

- outcome 如何关联到 claim
- 多个 outcome 如何聚合成 `outcome_score`
- 负向 outcome 是否衰减更快
- 不同 outcome strength 的默认值是什么

这是实现时一定会碰到的问题。

建议补一个最小规则集，比如：

### outcome 关联优先级
1. 显式 `related_claim_ids`
2. 否则通过 `related_event_ids -> source_event_ids` 回溯
3. 再不行才允许 heuristic matching

### outcome_score 更新策略
- `test_pass`, `human_kept`, `issue_closed` 正向加分
- `test_fail`, `commit_reverted`, `manual_override`, `human_corrected` 负向降分
- 分数在固定区间内裁剪，比如 `[-1, 1]` 或 `[0, 1]`

### 时间策略
- outcome 权重可时间衰减
- 但最近的负向 outcome 要更敏感

否则 “Outcome-aware Memory” 在实现层还是容易停留在理念。

## **4. Activation pipeline 还差 suppression logging**

你已经有 activation reasons 了，但还建议补 suppression log。

因为在调试阶段，很多时候最重要的问题不是“为什么它被召回”，而是“为什么另一条没被召回”。

建议在 `activation_logs` 或 debug 接口里保留：

- `claim_id`
- `eligibility_result`
- `suppression_reason`
- `rank_score`
- `packing_decision`

例如：

- `filtered: scope_mismatch`
- `filtered: superseded`
- `filtered: expired`
- `ranked_but_dropped: token_budget`
- `ranked_but_dropped: lower_than_thread_priority`

这会极大提升调试效率。

## **5. `NormalizedEvent` 还缺因果链字段**

现在 event schema 已经不错，但我建议补两个字段之一：

- `parent_event_id?`
- `causation_id?`

理由很简单：真实 agent 生命周期里，很多事件是链式的。

例如：

- 一条 user message
- 触发 agent tool use
- 导致 command_result
- 引发 file_edit
- 产生 test_result
- 最后形成 outcome

如果完全没有事件因果链，后续：

- claim 编译
- outcome 回溯
- debug trace
- benchmark 标注

都会变笨重。

即使 MVP 只先加一个可选字段，也值得。

## **6. `agent_version` 建议尽早定成必填**

你在 open questions 里问这件事，我的建议是：如果你能控制 adapter，就尽量设成必填。

因为后面做 benchmark、回归分析、质量漂移排查时，这个字段价值会非常高。  
尤其多 agent、多版本共同写 ledger 时，没有版本信息会很难分析：

- 某类 claim 是哪个版本开始污染的
- 哪个 adapter 改动导致 recall 质量下降
- 某个 agent 升级后 outcome 分布为何变化

哪怕一开始值允许是 `"unknown"`，也比字段缺失强。

## **7. 还缺一个“project identity”规则**

`project_id` 在文档里很核心，但没看到它如何确定。

这是个容易被低估的问题。你要做的是“共享同一份项目状态”，那就必须定义：

- project_id 是 repo remote URL 归一化？
- 本地路径 hash？
- mono-repo 子目录？
- fork 和 upstream 如何处理？
- 同仓库不同 worktree 是否同一 project？

如果这层不明确，多 agent 共享会在 project boundary 上出问题。

我建议你至少在后续 schema 文档里定义：

- `project_id generation strategy`
- `repo identity normalization`
- `subproject scope strategy`

否则后面 scope 和共享边界都会不稳定。

## **8. `memory.search` 的定位要再说清楚**

你保留了 `memory.search`，这没问题，但 V2 已经明确 MCP/tool 不是主路径，所以最好定义它到底是什么：

- debug/inspection search？
- agent fallback recall？
- human query interface？
- raw evidence search 还是 claim search？

因为 “search” 这个名字太宽了，容易让实现又回到老的“top-k 检索中心论”。

我建议你明确区分：

- `memory.search_evidence`
- `memory.search_claims`
- 或至少文档说明 `memory.search` 默认返回什么层

否则后面很容易语义漂移。

## **文档表达层面的几个小建议**

### **1. `runtime` 和 `kernel` 两个词最好统一主次**

现在文档里两个词都在用：

- project memory runtime
- persistent project memory kernel

这两个不冲突，但容易让外部读者产生“到底哪个是产品名，哪个是技术层”的疑问。

建议你选一个作为主名称，一个作为内部结构名。

比如：

- 对外产品名：`Project Memory Runtime`
- 对内架构描述：runtime 内部包含 memory kernel

或者反过来，但最好统一。

### **2. “全生命周期”建议补一句范围**

“lifecycle memory runtime” 很好，但建议写一句 lifecycle 指什么，不然读者会有不同理解。

比如你可以明确：

- capture lifecycle
- claim lifecycle
- recall lifecycle
- outcome lifecycle

这样“全生命周期”就不是抽象词，而是你架构的四个闭环。

### **3. open questions 和 decisions to confirm 可稍微合并重排**

现在第 21 节和第 22 节都在“待确认”，有一点点重复感。

建议改成：

- 已确认决策
- 待确认决策
- 实现前必须冻结的 contract

这样更像 implementation planning 文档。

## **如果我要挑一个最值得担心的风险**

不是技术复杂度，也不是 adapter 适配，而是：

### **thread / decision / fact 三类 claim 是否真的共用同一套 lifecycle 规则**

这是我现在最想提醒你的点。

因为这三类对象本体其实不完全同质：

- `fact` 更像可验证的当前真值陈述
- `decision` 更像项目历史中的约束或选择
- `thread` 更像待完成工作项

它们都可以共享一些通用字段，但未必适合完全共享同一状态机与 ranking 逻辑。

举例说：

- `fact` 被覆盖很自然是 `superseded`
- `decision` 被替换往往需要更强的人为确认
- `thread` 完成后不一定叫 `superseded`

所以我建议你在设计上继续维持统一 contract，但要准备接受：

- 通用 state machine 为基础层
- `thread` 可能需要专属 extension state
- ranking weights 可能按 type 分组配置

这不是推翻 V2，而是提醒你别为了统一而过度统一。

## **我会给 V2 的结论**

如果我是 repo maintainer 或设计评审人，我会给出这样的判断：

### **这版可以进入实现前规格冻结阶段了，但还不应该直接开写所有代码。**

更具体地说：

你现在最应该做的，不是继续写更长的总设计稿，而是按你第 23 节说的，快速拆出四份真正能指导实现的子文档：

- `schema-v1.md`
- `state-machine-v1.md`
- `adapter-contract-v1.md`
- `evaluation-protocol-v1.md`

而且我会再补一个：

- `identity-and-scope-v1.md`

因为 project identity、scope matching、canonical key 这三件事，其实是整套系统的数据根基。

## **我的最终评价**

V2 是一次非常成功的迭代。  
它已经不是“想法更好”，而是“结构更稳”。

比起 V1，这版最可贵的地方在于你没有继续发散，而是做了四件真正正确的事：

- 更聚焦
- 更约束
- 更兼容迁移
- 更接近 benchmark 驱动

所以我的结论是：这版值得继续推进，而且已经足够作为 phase-1 设计基线。下一步不该再反复争论大方向，而应该开始冻结几个关键 contract，避免实现阶段重新把抽象打散。