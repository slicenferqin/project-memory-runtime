

### **V2 版本评审：从“战略方向”到“工程契约”的成功跨越**

这份 V2 版本是一份质量非常高的架构设计文档。如果说 V1 是在回答“我们为什么要做这个（Why）”和“我们要做什么（What）”，那么 V2 已经非常清晰地回答了“我们要怎么做（How）”以及“系统的边界和契约是什么”。

你完美吸收了之前评审中提出的硬核建议：引入了 `verification_status`、丰富了 outcome 相关的事件模型、将 activation 从单一公式改成了三阶段 pipeline、补齐了状态机流转规则，并且明确了测试评估协议（Evaluation Protocol）。

更重要的是，**V2 在产品形态上做出了极其果断且正确的切分**：不再把自己包装成一个被动等待调用的“MCP Server”，而是定位为“Lifecycle-first 的 Memory Runtime”。这是一个本质的升维。

以下是我对 V2 版本的详细审阅，以及对文档末尾 "Open Questions" 和 "Decisions To Confirm" 的直接回应。

---

### **一、 核心亮点的工程化确认**

#### **1. 接入策略的根本转变：Lifecycle-first**
> *“能被动接入，就不依赖 agent 主动调用；能通过生命周期事件获得信号，就不通过提示词诱导‘记得调用工具’”*

这是整篇文档最值钱的一句话。
现有的 MCP 记忆方案最大的痛点就是“Agent 经常忘记调工具”或者“调工具的时机不对”。把记忆从“主动工具（Tool）”降维/升维成“底层运行时（Runtime + Hooks）”，直接解决了记忆系统的召回率和写入稳定性问题。

#### **2. 模型设计的闭环：Evidence -> Claim -> Outcome**
V2 的数据模型终于形成了一个严密的逻辑闭环：
- `NormalizedEvent` 是只追加的账本（底线事实）。
- `Claim` 是编译后的状态（带有 `verification_status` 和 `canonical_key`，避免了无意义的重复）。
- `Outcome` 是反馈回路（独立于 Claim，专门用于更新 `outcome_score`）。
这种设计让系统从一个“记事本”变成了一个“能通过结果学习的系统”。

#### **3. 状态机的引入（State Machine）**
明确了 `active -> stale -> superseded -> archived` 的单向流动（以及受控的逆向流动）。这对于工程实现来说是救命的，它告诉了开发者什么时候该降权，什么时候该直接丢弃，避免了向量库中常见的“垃圾数据越攒越多”的问题。

---

### **二、 对 "Open Questions" 的明确建议**

在文档的第 21 节，你提出了 6 个 Open Questions，以下是我的工程视角的建议：

#### **1. V1 claim type 是否严格只保留 `fact / decision / thread`？**
**建议：是的，严格保留这三类。**
- `fact` 解决“项目是什么样”（例如：用 pnpm，要求 100% 覆盖率）。
- `decision` 解决“为什么这么做”（例如：因为 A 所以不选 B，避免 agent 反复踩坑）。
- `thread` 解决“当前在干什么/还差什么”（跨 session 恢复上下文）。
这三者已经覆盖了 Coding Agent 95% 的核心痛点。引入 `preference` 或 `workflow_rule` 在 V1 阶段极易与 `fact/decision` 混淆，增加分类难度。保持克制，跑通闭环最重要。

#### **2. `verification_status` 是否进入顶层 contract？**
**建议：必须进入顶层。**
如果不在顶层，Activation Engine 的 Stage 2（Ranking）就无法直接读取它来做加权（`w_p * pin_or_verification_bonus`）。系统必须第一眼就能区分“这是系统验证过的真理”还是“这是 Agent 猜的假设”。

#### **3. `agent_version` 是否作为顶层必填字段？**
**建议：设为可选字段（Optional），但强烈建议收集。**
不同版本的 Claude/Codex 产生的事件质量可能差异巨大。未来在排查“为什么产生了一条错误的 decision”时，知道是哪个版本的 Agent 产生的至关重要。但不应设为强制，以免阻碍轻量级 Adapter 的接入。

#### **4. Codex 的第二阶段接入优先级是否高于 OpenCode？**
**建议：OpenCode 优先级应高于 Codex。**
原因很简单：你的核心策略是 **Lifecycle-first (Hooks/Plugins)**。OpenCode 作为开源/插件化生态，更容易拿到底层的 session 和 idle 事件；而 Codex 目前更封闭，大概率只能走传统的 MCP 或文件约定，这违背了你 V2 的主推策略。先在 OpenCode 跑通 Plugin 模式，能更好地验证你的 Runtime 架构。

#### **5. RecallPacket explanation 是否默认暴露给 adapter，还是仅用于 debug？**
**建议：默认打包进 `RecallPacket`，但 Adapter 决定是否喂给 LLM。**
Kernel 必须输出 `activation_reasons`，因为这是系统的可解释性底线。但是，Adapter 在将内容注入给 Agent（比如 Claude Code）时，可以选择将 explanation 放在不可见的 metadata 中，或者仅在用户输入 `/memory debug` 时展示。不要让 Kernel 去猜测 Adapter 的 UI 需求。

#### **6. `memory.upsert_claim` 是否完全移出 v1？**
**建议：移出面向 Agent 的 Tool Surface，但保留在 CLI (`memoryctl`) 中。**
Agent 只能 `record_event`，由 Compiler 去生成 Claim。绝对不能让 Agent 直接写 Claim，否则你的 Evidence Ledger 就被架空了。但人类开发者需要通过 `memoryctl` 手动纠偏或导入初始数据，所以这个 API 在底层和 CLI 中必须存在。

---

### **三、 对 "Decisions To Confirm" 的最终确认**

在文档的第 22 节，你列出了 6 个需要确认的决策。基于以上的分析，**这 6 个决策全部成立，可以直接拍板：**

1. **✅ 主交付物：runtime，而不是 MCP。**（这是最核心的产品升维）
2. **✅ 主接入方式：hooks/plugins，而不是 agent 主动调用。**（解决召回和写入的痛点）
3. **✅ truth model：evidence-first。**（保证数据的可追溯和防污染）
4. **✅ MVP 只做一个 reference adapter：Claude Code。**（克制，且 Claude 的 Hook 支持最完善）
5. **✅ RecallPacket 升为一等产品接口。**（标准化多 Agent 之间的通信协议）
6. **✅ MVP 先做 deterministic extraction baseline。**（避免初期过度依赖 LLM 导致的不稳定）

---

### **四、 下一步行动（Immediate Next Actions）的小补充**

你规划的下一步行动（Schema、State Machine、Adapter Contract、Evaluation、Plan）非常清晰。我只补充一个微小的工程建议：

在写 **`schema-v1.md`** 和 **`adapter-contract-v1.md`** 时，建议直接用 **JSON Schema** 或 **Zod/Zot** 的形式写出来，而不是纯 Markdown 文本。
因为既然是 Runtime 和 Adapter 之间的契约，后续一定会涉及跨语言（TS/Rust/Python）的序列化和反序列化，尽早确定严格的类型校验边界，能省去后期大量的扯皮时间。

### **总结**

这份 V2 文档已经完全具备了指导工程落地的成熟度。它不仅逻辑严密，而且对工程中的边界情况（如状态流转、去重、验证、如何防止数据污染）都做出了非常务实的防守设计。

**可以直接拿着这份文档进入开发规划阶段了。干得漂亮。**