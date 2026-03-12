# Project Memory Runtime

<div align="center">

**面向代码 Agent 的本地优先、全生命周期项目记忆运行时**

简体中文 | [English](./README_EN.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Status: Design Freeze](https://img.shields.io/badge/Status-Design%20Freeze-orange)](./docs/planning/contract-index.md)
[![Architecture: Runtime First](https://img.shields.io/badge/Architecture-Runtime%20First-black)](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)

[为什么是它](#为什么是它) • [核心原则](#核心原则) • [仓库结构](#仓库结构) • [当前阶段](#当前阶段) • [从哪里开始读](#从哪里开始读)

</div>

---

## 为什么是它

`Project Memory Runtime` 不是另一个 “memory MCP”，也不是一个让 Agent 主动调用的普通 CLI。

它解决的问题是：

- 新 session 如何恢复项目状态
- 旧决策如何不被反复推翻
- 未完成线程如何跨会话延续
- 哪些记忆可信、哪些记忆过时、哪些记忆真的帮助任务成功
- 多个 coding agent 如何共享同一份项目级状态

它的目标不是“像人一样记忆”，而是：

> **保留证据，编译记忆，按需激活，并让结果反过来塑造记忆。**

---

## 核心原则

### 1. Lifecycle-first

优先通过 `hooks / plugins / lifecycle events` 被动采集和注入，而不是依赖 Agent 主动记得调用某个工具。

### 2. Evidence-first

原始证据是 source of truth。  
Claim 必须可回溯到 evidence，而不是直接生成一堆不可解释的长期记忆。

### 3. Runtime-first

主交付物是 **memory runtime**，而不是 MCP server。  
MCP 只是未来的兼容桥接层，CLI 只是运维与调试接口。

### 4. Outcome-aware

记忆不只按相似度和时间衰减排序，还要吸收真实工程结果：

- 测试通过 / 失败
- commit 保留 / 回滚
- issue 关闭 / reopen
- 人类保留 / 修改 Agent 输出

### 5. Project Memory, not Human Memory

这个仓库聚焦的是 **项目级记忆**，不是人格陪伴式长期记忆。

---

## 当前抽象

V2 已经把系统收敛为四层：

1. **Evidence Ledger**  
   只追加的项目事件账本

2. **Claim Store**  
   带验证状态、作用域、生命周期的结构化记忆

3. **Activation Engine**  
   负责 eligibility、ranking、budget packing，而不是单纯 top-k 搜索

4. **Outcome Loop**  
   让测试、提交、issue、人工修正等结果反哺记忆质量

对外的主产品接口不是数据库，也不是搜索 API，而是：

- `RecallPacket`
- lifecycle adapters
- `memoryctl`

---

## 仓库结构

```text
project-memory-runtime/
├── docs/
│   ├── planning/
│   │   ├── 2026-03-12-project-memory-kernel-design-v2.md
│   │   ├── contract-index.md
│   │   ├── identity-and-scope-v1.md
│   │   ├── state-machine-v1.md
│   │   ├── schema-v1.md
│   │   ├── adapter-contract-v1.md
│   │   ├── evaluation-protocol-v1.md
│   │   └── compiler-and-ingestion-v1.md
│   └── reviews/
├── packages/
│   ├── runtime/
│   ├── adapters/
│   │   ├── claude-code/
│   │   └── opencode/
│   └── bridges/
│       └── mcp/
└── tools/
    └── memoryctl/
```

---

## 当前阶段

当前仓库仍处于 **design freeze / contract freeze** 阶段。

现在最重要的事情不是继续扩写愿景，而是冻结实现契约：

- identity / scope
- state machine
- schema
- adapter boundary
- evaluation protocol
- compiler / ingestion rules

Phase 1 的目标会是：

- 跑通最短闭环
- 建 SQLite ledger / claim / outcome 基础表
- 建 runtime 骨架
- 先做 Claude Code reference adapter

---

## 从哪里开始读

如果你第一次进入这个仓库，推荐阅读顺序：

1. [Contract Index](./docs/planning/contract-index.md)
2. [V2 Design](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)
3. [Identity And Scope v1](./docs/planning/identity-and-scope-v1.md)
4. [State Machine v1](./docs/planning/state-machine-v1.md)
5. [Schema v1](./docs/planning/schema-v1.md)
6. [Adapter Contract v1](./docs/planning/adapter-contract-v1.md)
7. [Evaluation Protocol v1](./docs/planning/evaluation-protocol-v1.md)
8. [Compiler And Ingestion v1](./docs/planning/compiler-and-ingestion-v1.md)

---

## 与 `universal-memory-mcp` 的关系

`universal-memory-mcp` 仍然有价值，但它现在更适合作为：

- 兼容层
- 维护线
- 未来的 MCP bridge / legacy adapter 来源

新的主线从这里开始：

- runtime-first
- lifecycle-first
- project-memory-first

旧仓库地址：

- [slicenferqin/universal-memory-mcp](https://github.com/slicenferqin/universal-memory-mcp)

---

## 许可证

本仓库使用 **GPL-3.0** 许可证。

原因很简单：

- 这是一个新主线仓库
- 希望后续围绕 runtime、adapter、bridge 的演化保持强共享与回流
- 旧仓库 `universal-memory-mcp` 仍保留其原有许可与维护策略
