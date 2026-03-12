

V2 是一次非常扎实的升级。相比 V1，你已经把"方向正确"转化成了"可落地的规范"，绝大多数之前评审中提出的问题都得到了有效的收敛。以下是完整的第二轮评审。

---

### **总评：V2 已经可以作为 implementation planning 的基础文档，但还有五处值得在开工前收紧**

先说结论：V2 已经不是方向稿，而是一份接近可以拆任务的设计文档。你在这一版里补上了状态机、三阶段 activation pipeline、独立的 Outcome 模型、RecallPacket 的可解释性要求、deterministic extraction baseline、evaluation protocol 和迁移三阶段——这些都是 V1 里最大的空洞，现在基本填上了。

但还有五处值得在开工前进一步收紧，否则实现时会遇到比较具体的阻力。

---

### **V2 做对的部分，值得明确肯定**

**"Lifecycle-first, transport-agnostic"这个策略是本版最大的进步。** V1 里 MCP 还有一定的架构中心感，V2 把它降到"兼容桥接层"，把 hooks/plugins 提升为主 capture 路径，这是非常正确的判断。原因很简单：如果 agent 必须主动调用 memory tool 才能触发记忆，那么 prompt 里必须有对应的指令，而指令是可以被遗漏或稀释的；但 hooks 是强制生命周期绑定，不依赖 agent 自身的意愿。这个策略转变是真正的架构升级，不只是表述调整。

**独立的 `Outcome` 模型是正确的解耦决策。** V1 里 outcome 信号全部塞在 Claim 本体里，这在后续会产生两个问题：一是 Claim 会变得很重；二是 outcome 无法独立 audit 和 replay。你把它拆出来单独定义，并且保留了 `related_claim_ids` 和 `strength`，这让 outcome loop 成为一个可以独立测试的子系统。

**`ThreadClaimExtension` 里的 `resolution_condition` 是这份文档里最有工程价值的细节之一。** "thread 不应只靠 LLM 判断关闭，尽量绑定 machine-resolvable outcome signal"——这条原则如果真正落实，会让 open thread 的生命周期管理变得可测、可审计，而不是靠模型猜测。

**Deterministic Extraction Baseline 作为独立章节是对的。** 你把规则优先的 claim 和 LLM 增强的 claim 分开列，并且明确"没有 deterministic baseline 的 claim，不进入 MVP 的核心闭环"，这是一个非常务实的 MVP 边界定义。

---

### **需要收紧的第一处：`canonical_key` 还没有定义规范**

`canonical_key` 是整个 claim lifecycle 里最关键的字段，因为它决定了"覆盖判定"、"冲突检测"、"supersede 链接"是否能正确工作。但 V2 只是在 Schema 里出现了这个字段，没有定义它的命名规范。

这会在实现时直接产生问题。比如：

- `repo.package_manager` 和 `project.package_manager` 是同一个 key 还是两个？
- `branch.hotfix.priority` 应该绑定到 branch 名称吗？如果绑定，branch 切换后 key 是否跟着变？
- `decision.auth.strategy` 是全局 key 还是 scope-qualified key？

建议在 `schema-v1.md` 里补充一节 `canonical_key` 命名约定，至少定义：

- 命名格式：建议用 `{domain}.{subdomain}.{attribute}` 的点分路径，全小写，不含空格
- scope 绑定规则：repo-level key 不带 branch；branch-level key 带 branch 名或 `{branch}` 占位符
- 覆盖规则：同一 `canonical_key` + 同一 scope 的新 claim 自动 supersede 旧 claim；不同 scope 的相同 key 不自动覆盖

如果不定义这个规范，compiler 里的去重逻辑会非常难写，而且不同 adapter 写出来的 key 会完全不一致。

---

### **需要收紧的第二处：Activation Pipeline 里的权重初始值和调参机制没有定义**

V2 的加权公式是：

$$
rank\_score = w_r \cdot R + w_f \cdot F + w_c \cdot C + w_i \cdot I + w_o \cdot O + w_s \cdot S + w_p \cdot P
$$

这比 V1 的乘法公式好很多，但还缺两件事。

**第一，初始权重没有给出推荐值。** 实现时第一个问题就是"这些 w 初始设多少"。如果没有任何参考值，开发者要么随机拍，要么等 evaluation 出结果再调，但在 evaluation 出结果之前系统就已经跑起来了。建议在文档里给出一组 v1 默认权重，哪怕是粗略的，比如：

- $w_s = 0.3$（scope match 最重要，因为 scope 不对的 claim 基本没用）
- $w_c = 0.25$（confidence 次之）
- $w_p = 0.2$（pin/verification bonus，保证强信号不被淹没）
- $w_r = 0.1, w_f = 0.1, w_i = 0.05, w_o = 0.0$（v1 outcome 数据还少，先给低权重）

这组值不需要精确，但需要存在，因为它是第一次 benchmark 的起点。

**第二，`freshness` 的衰减函数没有定义。** 时间新鲜度这个维度，必须有一个具体的衰减曲线，否则实现者不知道"1天前的 claim"和"30天前的 claim"的 freshness 分别是多少。建议至少定义衰减函数的形式，比如指数衰减：

$$
F = e^{-\lambda \cdot \Delta t}
$$

其中 $\lambda$ 可以按 claim type 分别设置：`fact` 衰减慢（$\lambda$ 小），`thread` 衰减快（$\lambda$ 大），`decision` 居中。

不定义这个，`freshness` 这一维度在实现时会变成"每人自己理解"。

---

### **需要收紧的第三处：`Outcome` 到 `Claim` 的反哺机制还是黑箱**

你定义了 `Outcome` 对象，也说了"用于更新 `Claim.outcome_score`"，但没有定义这个更新的具体规则。这是 outcome-aware memory 最核心的机制，不能留成黑箱。

建议至少定义一个 v1 的 outcome update rule，例如：

对于 `outcome_type == "test_pass"` 或 `"commit_kept"` 或 `"issue_closed"`，将关联 claim 的 `outcome_score` 按以下规则更新：

$$
outcome\_score_{new} = outcome\_score_{old} + \alpha \cdot strength \cdot (1 - outcome\_score_{old})
$$

这是一个简单的向上收敛公式，保证 score 不会超过 1，而且每次正向 outcome 都会带来增量提升。

对于负向 outcome（`"test_fail"`, `"commit_reverted"`, `"human_corrected"`）：

$$
outcome\_score_{new} = outcome\_score_{old} - \beta \cdot strength \cdot outcome\_score_{old}
$$

同样收敛，不会变负数。

$\alpha$ 和 $\beta$ 是可调参数，v1 可以先都设为 `0.1`。

这不是唯一的做法，但你需要在文档里给出一个具体的 v1 规则，否则 outcome loop 就只是一个概念，而不是一个可实现的子系统。

---

### **需要收紧的第四处：`stale` 的自动触发条件还不够具体**

状态机里你写了"长期未验证但仍可能有效 -> `active -> stale`"，但"长期"是多久？这个问题在实现时会立刻变成一个阻塞项。

建议按 claim type 分别定义 stale TTL：

| type | stale TTL（建议 v1 默认值） |
|---|---|
| `fact` | 90天无验证 |
| `decision` | 60天无验证 |
| `thread` | 14天无 resolution signal |

同时，`stale` 触发除了时间之外，还应该有事件触发条件，比如：

- 同一 `canonical_key` 出现了新的 conflicting evidence，但尚未明确 supersede -> 触发 `stale`
- 关联的 branch 被 delete，但 thread 未关闭 -> 触发 `stale`

这些规则不需要在 V2 里全部列完，但至少要有"时间 TTL + 事件触发"两类的框架，否则 cron 维护任务里的 `stale review` 不知道按什么标准执行。

---

### **需要收紧的第五处：`Open Questions` 里有几个问题可以直接在 V2 里关闭**

你列了 6 个 Open Questions，但其中有几个其实 V2 文档本身已经给出了足够的依据，不应该继续悬置。

**Q1："V1 claim type 是否严格只保留 `fact / decision / thread`"** — 可以关闭，答案是 Yes。你在 9.2 里已经给出了充分理由，这个决策应该在 V2 里 confirm，而不是继续留作 open question。

**Q2："`verification_status` 是否进入顶层 contract"** — 可以关闭，答案是 Yes。你在 Schema 里已经把它放进去了，而且你在 Ranking 里明确了 `system_verified / user_confirmed` 获得 bonus，说明这个字段是 activation 的一级输入，必须进顶层 contract。

**Q6："`memory.upsert_claim` 是否完全移出 v1"** — 可以关闭，答案是 Yes，移出默认路径，保留为 migration/admin only。你在 15.2 里已经给出了完整理由。

建议把这三个问题从 Open Questions 里移到 Decisions To Confirm，并且直接标记为 confirmed。剩下的 Q3、Q4、Q5 才是真正需要讨论的。

---

### **一个结构性建议：`Decisions To Confirm` 应该变成 `Decisions Log`**

你现在的 Section 22 是"Decisions To Confirm"，这是好的，但随着项目推进，这里需要演化成一个有状态的决策日志，而不是一个待确认清单。

建议把格式改成：

```
| # | 决策 | 状态 | 确认时间 | 确认方式 |
|---|---|---|---|---|
| D1 | 主交付物：runtime，而不是 MCP | confirmed | 2026-03-12 | V2 review |
| D2 | 主接入方式：hooks/plugins | confirmed | 2026-03-12 | V2 review |
| D3 | truth model：evidence-first | confirmed | 2026-03-12 | V2 review |
| D4 | ... | pending | - | - |
```

这样做的好处是，后续的 `schema-v1.md` 和 `adapter-contract-v1.md` 可以直接引用决策编号，而不是重新解释背景。这在多人协作或跨文档引用时特别有价值。

---

### **关于 Section 23 `Immediate Next Actions`：顺序建议调整**

你列的五个 next actions 是对的，但顺序建议微调：

你现在的顺序是 schema -> state machine -> adapter contract -> evaluation protocol -> implementation plan。

我建议把顺序改成：

1. **`state-machine-v1.md`** 先于 schema，因为状态机定义了 claim 的合法状态迁移，schema 里的字段（比如 `status`、`valid_to`）需要以状态机为基础才能确认完整性。
2. **`schema-v1.md`**，包括 `canonical_key` 命名规范和 outcome update rule。
3. **`adapter-contract-v1.md`**，基于 schema 和状态机确认后才能写稳。
4. **`evaluation-protocol-v1.md`**。
5. **`phase-1-implementation-plan.md`**。

这个顺序调整不大，但会减少"写 schema 时发现状态机没说清楚，要回头改"的来回。

---

### **文档质量层面的最后两点**

**Section 2 "为什么需要 V2"里的"三份独立评审"可以稍微具体化。** 你写了"Claude / Gemini / GPT-5.4 三份交叉评审综合收敛"，这对外部评审者来说是有价值的背景信息，但建议补一个链接或附件引用，否则读者不知道这三份评审的结论是否真的一致，还是你做了选择性收敛。你在 Section 24 参考资料里已经引用了两个 TabAI 会话文件，建议在 Section 2 里也直接引用它们。

**`memoryctl` 这个工具在文档里出现了两次（Section 3.2 和 Section 18.1），但没有独立的设计章节。** 既然它是一个独立交付物，建议要么在 V2 里补一节最小定义（哪怕只有 5 个命令），要么在 Section 23 的 next actions 里加一条 `memoryctl-spec-v1.md`。

---

### **如果我是 implementation lead，我会从 V2 里提取的第一个 sprint**

基于 V2 的范围定义，第一个 sprint 最合理的范围是：

把 `canonical_key` 命名规范 + claim state machine + SQLite schema 三件事同时做完，然后写一个最小的 compiler，只支持 deterministic extraction 的 `repo.package_manager` 和 `repo.test_framework` 两个 fact，跑通"event -> ledger -> claim -> recall packet -> session brief"这条最短路径，再写第一个 benchmark case（session recovery）。

这样做的好处是：你会在第一个 sprint 结束时就知道 `canonical_key` 的命名规范是否合理、状态机的迁移规则是否够用、RecallPacket 的格式是否真的能让 Claude Code 恢复项目状态。而不是等到所有模块都写完才发现基础契约有问题。

---

### **总结**

V2 已经从"方向稿"升级成了"实现规划文档"，整体质量很高。五处需要收紧的地方是：`canonical_key` 命名规范、activation 权重初始值与 freshness 衰减函数、outcome 到 claim 的反哺更新规则、stale 自动触发的具体条件、以及把几个已经有答案的 Open Questions 关闭掉。把这五处补上之后，`schema-v1.md` 和 `state-machine-v1.md` 就可以直接开始写了。