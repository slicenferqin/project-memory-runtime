### **这 5 个 contract 已经达到“可以作为 Phase 1 实现基线”的水平；现在主要问题不再是方向是否成立，而是少数跨文档一致性、默认策略边界和未来演化接口还需要再压一遍。**

这次我会直接给一个更明确的判断：  
如果你现在开始按这 5 份 contract 拆任务、建表、写 runtime 骨架，我认为是合理的。它们已经不是“思路文档”，而是具备了比较清楚的契约作用。尤其是你把最容易漂移的几件事都冻结了：

- identity 与 scope 分离
- adapter 不拥有 truth model
- claim 必须 evidence-first
- thread 使用双层状态
- evaluation 不再只看检索命中率
- activation/suppression 都要求可解释

这套设计已经明显有“系统味道”了，而不是一个记忆插件的功能清单。

## **整体评价**

我先说总印象：这 5 份文档之间的互相咬合度，比 V2 主文档本身还重要，而你现在做得已经相当不错。尤其是下面这几条，是我认为真正把系统做“稳”的地方。

### **第一，Identity / Scope 被单独抽出来是对的**

`identity-and-scope-v1.md` 很关键，因为这类系统最容易在“共享边界”上失控。你现在明确了：

- `repo_id` 是仓库身份
- `project_id` 是共享单元
- `workspace_id` 是本地副本身份
- `session_id` 是会话身份

而且把 worktree、clone、branch、monorepo 子项目都纳入规则了。这一步非常重要，因为如果 project identity 一开始模糊，后面所有 recall、supersede、multi-agent consistency 都会带着歧义。

我尤其认可这句逻辑：  
`repo-level truth, workspace-level context`

这句话实际上把很多未来争议提前打掉了。

### **第二，Schema / State Machine / Adapter 的职责边界很清楚**

你现在已经形成一个比较稳定的分工：

- `schema-v1` 冻结字段和默认值
- `state-machine-v1` 冻结迁移语义
- `adapter-contract-v1` 冻结谁能做什么、不能做什么
- `evaluation-protocol-v1` 冻结怎么证明它有效
- `identity-and-scope-v1` 冻结共享边界和 key 规则

这说明你没有把所有规则都塞进一份大设计稿，而是在做真正的 contract decomposition。这个做法是成熟的。

### **第三，thread 的双层状态设计是本轮文档里最值得保留的决定之一**

这是我之前最担心的点之一，而你现在已经处理得比较合理：

- 通用 `status` 表示 recall/lifecycle
- 专属 `thread_status` 表示工作项语义

这个区分让 `thread` 不必被硬塞进 `superseded` 这种不自然的完成语义里。并且你定义了：

- resolved 后默认 `active -> archived`
- blocked 仍可进入 `open_threads`
- resolved 默认不进入 `open_threads`

这个逻辑是自然的，也便于 adapter 和 recall 层消费。

## **逐份评审**

## **一、`identity-and-scope-v1.md`**

这是五份里最基础、也最成功的一份之一。

### **优点**

你把 identity 层级定义得很清楚，而且没有把 branch、worktree 误当项目身份，这非常好。特别是：

- `canonical remote first, local fallback second`
- fork 默认不同 `repo_id`
- monorepo 用 `repo_id::subproject_id`
- scope 采用 `most-specific wins, broader-scope falls back`

这些都很有工程可执行性。

`canonical_key` 部分也明显更成熟了，尤其是：

- 规定格式 `<domain>.<entity>.<attribute>[.<qualifier>]`
- 全小写、点分路径、不可编码时间戳/session id
- 引入 `cardinality = singleton | set`

这里我认为你已经把很多后期数据污染风险压下去了。

### **我建议补的一点**

#### **1. `repo_id` 的 remote 选择规则还可以更硬一点**

你现在写：

1. `origin`
2. upstream remote
3. 其他唯一 remote

这个大体没问题，但我建议补一个例外：  
如果 `origin` 明显是 fork，而 `upstream` 才是团队主仓，是否仍坚持 `origin` 优先？

你当前文档已经明确“fork 默认不同 repo_id”，所以逻辑上是自洽的。但为了避免实现者犹豫，建议再写一句：

- V1 不做 fork/upstream 自动合并
- 即使存在 upstream remote，仍以当前 checkout 的 canonical remote 为 repo identity
- 任何跨 fork 记忆共享都必须走显式 import

这样实现层就不会有人偷偷做“智能合并”。

#### **2. `scope` 与 `project` / `repo` 语义略有重叠**

你列了 scope 层级：

1. `project`
2. `repo`
3. `branch`
4. `cwd_prefix`
5. `files`

但 schema 里的 `ClaimScope` 和 `EventScope` 目前实际字段是：

- `repo`
- `branch`
- `cwd_prefix/cwd`
- `files`

没有单独 `project` 字段。

所以这里建议统一口径：  
要么文档里说“project scope 由 scope 为空表示”；  
要么在 schema 中显式增加 `project?: true` 之类标志。

我更建议前者：  
“空 scope 即 project-wide scope”。  
这样更简洁，也更符合你当前示例。

#### **3. `file-level override` 的 recall 合并策略可以补一句**

你现在说 file scope 不自动 supersede project-level，它只是更具体 override。这个对。  
但 recall 时最好再明确：

- 当 file scope 命中时，project-level 同 key claim 是保留为 fallback，还是默认不一起展示？

否则 adapter 可能同时注入两条语义冲突的 claim。  
我建议补成：

- recall 默认优先保留 most-specific active claim
- broader fallback claim 仅在 debug/explain 模式暴露

这样对 runtime 行为更明确。

## **二、`schema-v1.md`**

这份文档已经很像真正的“实现说明书”了。

### **优点**

几个我很认可的点：

- `agent_version` 变成 required，未知时写 `"unknown"`
- 加了 `parent_event_id` / `causation_id`
- `outcome_score` 固定到 `[-1, 1]`
- `ActivationLog` 单独作为核心对象
- ranking 权重有默认值，不留黑箱
- outcome update 有明确公式

尤其 `ActivationLog` 的加入很重要，这会让后续 benchmark 和 debug 成本低很多。

### **我建议重点再看三点**

#### **1. `w_o = 0.00` 是合理的，但要写清楚是“排序权重”，不是 outcome 无效**

现在看到这组默认权重：

- `w_s = 0.30`
- `w_c = 0.25`
- `w_p = 0.20`
- `w_r = 0.10`
- `w_f = 0.10`
- `w_i = 0.05`
- `w_o = 0.00`

这在 MVP 初期是合理的，因为 outcome 稀疏，贸然给高权重会不稳定。

但建议文档加一句强调：

- `w_o = 0.00` 仅表示 v1 初始 ranking 不直接消费 outcome_score
- outcome 仍参与 stale 延缓、verification strengthening、benchmark 记录和未来调参

否则读者会疑惑：既然 Outcome 这么重要，为何默认权重是 0。

#### **2. `Claim` 和 `ThreadClaimExtension` 的合并表示法要更明确**

目前 schema 把 `ThreadClaimExtension` 单独写出来，但没有明确“thread 类型 claim 在存储层是同表 nullable fields，还是外联扩展表”。

你不一定要现在决定数据库分表，但 contract 层最好至少写一句：

- V1 contract 语义上允许 `thread` 携带扩展字段
- 存储实现可选择同表 nullable columns 或 extension table

这样后面实现者不会因为结构形式吵起来。

#### **3. `ActivationLog.suppression_reason` 的枚举还可以再多两个**

你目前有：

- `scope_mismatch`
- `superseded`
- `archived`
- `expired`
- `low_rank`
- `token_budget`

我建议再加：

- `project_mismatch`
- `verification_guard`

原因是：

- `project_mismatch` 是一类非常基础的硬过滤，值得单独显式记录
- 某些 claim 未来可能因 `disputed` 或 verification policy 被拦下，这不完全等于 low_rank

这样 failure analysis 会更清楚。

## **三、`state-machine-v1.md`**

这份文档的质量也不错，而且解决了之前最大的语义问题。

### **优点**

我最认可的三点是：

- 明确了三类 claim 虽共用基础状态机，但语义不同
- `thread` 使用双层状态
- stale = 时间 TTL + 事件触发

这已经比很多系统只写“active/stale/archived”强太多了。

`verification_status == disputed -> 默认 status = stale` 这一条也很实用，因为 disputed claim 不应该继续像正常 active claim 一样混入 recall。

### **建议补的点**

#### **1. `decision.active -> superseded` 的“高影响”判定还缺规则**

你写了：

- 高影响 decision 的 supersede 需要人工确认或强验证

这方向是对的，但“高影响”还比较主观。  
建议至少定义一个最小判断来源：

- `pinned == true`
- `canonical_key` 命中高风险前缀，如 `decision.security.*`、`decision.deploy.*`
- 或配置层显式声明 `high_impact = true`

否则不同实现会有不同解释。

#### **2. `thread resolved -> archived` 很合理，但建议保留 `resolved_at`**

你现在默认：

- `thread_status = resolved`
- `status = archived`

这我认同。

但建议 schema 或 state machine 增加一个字段概念，比如：

- `resolved_at?: string`

否则后续很难做：

- 最近完成线程回顾
- resolution latency benchmark
- open/blocked/resolved 转化分析

你不一定要现在入核心 schema，但应该在文档里预留。

#### **3. stale TTL 建议明确“无验证”的起点**

你写的是：

- fact：90 天无验证
- decision：60 天无验证
- thread：14 天无 resolution signal

这里建议明确计时起点到底是：

- `last_verified_at`
- `valid_from`
- `ts(created_at)`
- 还是 `last_activated_at` 不参与 TTL

我建议明确为：

- stale TTL 以 `last_verified_at` 优先
- 若为空，则退回 claim 首次生成时间
- `last_activated_at` 不延长 TTL

这是个很关键的反污染规则。否则“因为经常被召回所以一直不 stale”会造成错误强化。

## **四、`adapter-contract-v1.md`**

这份文档让我比较放心，因为它成功把 adapter 从“半个内核”压回了“桥接层”。

### **优点**

最重要的是这些原则：

- adapter 不直接写 claim
- adapter 不拥有 truth model
- adapter 失败不应破坏主流程
- recall explanation 对 adapter 可见
- `memory.search` 默认搜索 claims

这些都很对。

尤其第 8 节把 `memory.search` 的语义讲清楚了，这很好，因为否则 search 很容易反客为主，把系统又拉回 retrieval-centered。

### **我建议再补两个点**

#### **1. `capture()` 返回 `NormalizedEvent[]` 很好，但最好补“空数组合法”**

很多 hooks 或 plugin event 不一定总能转成有效事件。  
建议明确：

- `capture()` 返回空数组是合法行为
- adapter 不应为凑事件而伪造低质量 evidence

这会减少 adapter 实现为了“有输出”而乱写 event。

#### **2. `RecallAdapter.injectSessionBrief()` 的幂等策略可以补一句**

在某些 agent 生命周期里，`SessionStart` 或 `PreCompact` 可能重复触发。  
建议说明：

- recall injection 应尽量避免重复注入相同 packet
- adapter 可以基于 `generated_at` / packet hash / session marker 做去重

否则实际使用时可能出现 prompt 重复污染。

## **五、`evaluation-protocol-v1.md`**

这份文档虽然最短，但我认为非常重要，因为它决定这个项目会不会最终沦为“自我感觉 recall 更聪明了”。

### **优点**

你做对了三件事：

- 把 runtime 而不是模型表现作为评估对象
- 强制保留 `no-memory` 和 `simple-search` baseline
- 把可解释性也纳入验收项

这会让你后面调 activation、scope、stale 策略时更有依据，而不是凭主观体验。

### **我建议补的点**

#### **1. Session Recovery Benchmark 最好定义标准答案来源**

你现在要评估：

- 当前项目状态
- 当前分支重点
- 未完成线程
- 关键决策

但最好明确“ground truth 从哪里来”。建议定义为：

- 由人工标注 gold snapshot
- 或由冻结的 claims + active threads 生成 gold answer

否则恢复成功率会有主观性。

#### **2. Outcome Learning Benchmark 建议加“round 数”**

你写“重复 round 中平均 rank 上升/下降”，这是对的。  
但建议至少定义：

- benchmark 至少 3 轮或 5 轮 outcome 注入
- 每轮后重算 rank

这样实验更标准化。

#### **3. Multi-agent Consistency Benchmark 建议加“不同 workspace 同 project_id”的 case**

你已经覆盖共享项目，但建议明确纳入：

- 同 repo 不同 clone
- 同 repo 不同 worktree
- 同 monorepo 不同 subproject

因为这其实是在验证 `identity-and-scope-v1` 是否真的落地。

## **跨文档一致性检查**

总体上，这五份文档已经比较一致了，但我还是看到几个值得统一的小点。

### **1. `resolution_condition` 与 `resolution_rules` 命名已经演进，建议彻底统一**

在较新的 schema/state machine 中你已经使用 `resolution_rules`，这是更好的。  
如果别处还残留 `resolution_condition` 的说法，建议统一全改掉，避免后续文档读者误解为两个概念。

### **2. “project scope” 的表达方式建议全局统一成“空 scope”**

现在 identity 文档说有 `project` scope 概念，但 schema 并无 `project` 字段。  
建议在所有文档统一一句：

- absence of narrower scope fields means project-wide scope

这样最清晰。

### **3. `ActivationLog` 和 `claim_transitions` 的边界可再清楚一点**

schema 中说：

- `activation_logs`
- `claim_transitions`

state machine 中又说迁移可以记录在 `activation_logs` 或专门 `claim_transitions`

我建议尽量冻结下来，不要模糊：

- `activation_logs` 只记录 recall/packing 相关决策
- `claim_transitions` 专门记录状态迁移审计

这是更干净的做法。否则一个表会混两种不同语义。

## **我认为现在最值得补的一份文档**

如果你还要再补一份，我建议不是再写大设计稿，而是写：

### **`compiler-and-ingestion-v1.md`**

因为现在你已经有：

- identity
- schema
- state machine
- adapter
- evaluation

但还缺“compiler 到底何时、如何、按什么规则把 event 变 claim / outcome”的操作规约。

这会是下一个实现争议点。  
我建议这份文档至少冻结：

- 哪些 event 触发即时编译
- 哪些走批处理
- deterministic extractors 列表
- conflict review 入口
- outcome linking 执行时机
- stale sweep 执行周期

这会把 runtime 真正闭环起来。

## **最终判断**

如果现在问我一句：

“这五个 contract 能不能支撑开始做 phase-1 implementation？”

我的答案是：能，而且基本够了。

但如果问：

“它们是不是已经完全不用再动？”

我的答案是：还没到那个程度。  
你现在最该做的，不是推翻，而是再做一次“跨文档一致性压缩”，把几个容易分叉的点彻底统一：

- project scope 的表达
- activation log 与 transition log 的边界
- stale TTL 起算点
- high-impact decision 的判定来源
- thread resolved 的时间字段
- compiler/ingestion 的执行契约

### **我的总体结论**

这套 contract 现在已经具备很强的实现指导价值。  
它最大的成功，不是“设计得更复杂”，而是把复杂性放在了正确的位置：

- 用 identity 解决共享边界
- 用 scope 解决局部覆盖
- 用 state machine 解决生命周期
- 用 adapter contract 解决平台接入
- 用 evaluation protocol 解决是否真的有效

这说明这套系统已经从“一个聪明的 memory idea”变成了“一个可工程化的 memory runtime”。