# Project Memory Runtime

<div align="center">

**面向代码 Agent 的本地优先、全生命周期项目记忆运行时**

简体中文 | [English](./README_EN.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/nicepkg/project-memory-runtime/ci.yml?label=CI)](https://github.com/nicepkg/project-memory-runtime/actions)
[![Architecture: Runtime First](https://img.shields.io/badge/Architecture-Runtime%20First-black)](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)

[快速上手](#快速上手) • [为什么是它](#为什么是它) • [核心原则](#核心原则) • [CLI 命令](#cli-命令) • [仓库结构](#仓库结构)

</div>

---

## 快速上手

```bash
# 1. Claude Code：一次性安装到用户级 Claude 配置（推荐）
pmr install-global

# 2. 进入任意 git 项目 → Claude Code 会自动接管
#    新项目默认写入共享全局库
#    已有 .memory/runtime.sqlite 的老项目继续走本地库

# 3. 新会话看到可信记忆：
#    decision.persistence.backend: Use SQLite [✓ 3 test passes]

# 4. 随时检索
pmr search "为什么用 SQLite"
pmr explain <claim-id>
pmr snapshot
pmr status
```

`install-global` 命令只服务 **Claude Code shell hooks**，会自动完成：
- 写入用户级配置到 `~/.claude/project-memory-runtime/config.json`
- 安装 12 个托管生命周期 hooks 到 `~/.claude/settings.local.json`
- 安装全局 Skill 到 `~/.claude/skills/project-memory/`
- 初始化共享数据目录 `~/.claude/project-memory-runtime/data/`

如果你使用的是 **Claude Agent SDK**，不走这条安装路径，而是在应用代码里接入：

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { withProjectMemory } from "@slicenfer/project-memory-adapter-claude-agent-sdk";

const stream = query({
  prompt: "Fix the failing tests in this repo.",
  options: withProjectMemory({
    cwd: process.cwd(),
    settingSources: ["project"],
    permissionMode: "acceptEdits",
  }),
});
```

说明：
- SDK 默认不会自动加载磁盘 settings
- `withProjectMemory()` 不会偷偷追加 `settingSources`
- 如果你希望保留 `CLAUDE.md` / `.claude/skills` / 项目 settings 语义，需要由应用自己传 `settingSources`

兼容规则：
- 新 git 仓库默认走共享全局库
- 检测到已有 `.memory/runtime.sqlite` 的老项目时，继续使用本地库
- 可通过 `.claude/project-memory.json` 为单个仓库显式 `disabled` 或 `local`

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

当前实现额外补上了一个面向续窗的最小对象：

5. **Session Checkpoint**
   在 `PreCompact / SessionEnd / PostCompact / StopFailure` 上生成结构化工作态快照，并在新 session 启动时做最小重建校验

---

## CLI 命令

```bash
pmr install-global                    # 一次性安装用户级 hooks + skill + 共享 DB
pmr validate-global                   # 校验全局安装
pmr uninstall-global                  # 卸载全局 hooks + skill + config
pmr init                              # 兼容模式：为当前仓库安装本地 hooks + skill + DB
pmr search "query"                    # 搜索项目记忆
pmr search --type decision            # 按类型过滤
pmr search --status active --limit 10 # 按状态过滤
pmr explain <claim-id>                # 溯源：证据 → claim → outcome 时间线
pmr snapshot                          # 项目全景
pmr status                            # 记忆库概览
```

### Outcome 可视化

Session Brief 注入效果：
```
Active Decisions:
  decision.persistence.backend: Use SQLite [✓ verified: 3 test passes, 1 build pass | confidence: 0.90]

Open Threads:
  thread.issue.42: Refactor auth module [⚠ no outcome yet | open 5 days]
```

`pmr explain` 输出 outcome 时间线：
```
Claim: decision.persistence.backend — "Use SQLite as backend"
Status: active | Confidence: 90% | Score: +0.82

Timeline:
  2026-03-12  Claim created (user_confirmed)
  2026-03-12  test_pass → score: +0.00 → +0.10
  2026-03-13  build_pass → score: +0.10 → +0.19
  2026-03-14  test_pass ×3 → score: +0.19 → +0.44
  2026-03-15  commit_kept → score: +0.44 → +0.82
```

---

## 仓库结构

```text
project-memory-runtime/
├── packages/
│   ├── runtime/              # @slicenfer/project-memory-runtime-core
│   ├── cli/                  # project-memory-runtime (CLI: pmr)
│   └── adapters/
│       ├── claude-code/      # @slicenfer/project-memory-adapter-claude-code
│       └── claude-agent-sdk/ # @slicenfer/project-memory-adapter-claude-agent-sdk
├── tools/
│   ├── memoryctl/            # 开发者管理工具
│   └── benchmarks/           # 性能基准测试
├── docs/
│   ├── planning/             # 设计文档
│   └── reviews/
└── .github/workflows/        # CI + 发布流水线
```

---

## 当前阶段

**Phase 2 完成**，包括：

- 一次性全局安装 `pmr install-global`
- 共享全局数据路由（显式路径 > repo override > legacy local > global）
- 5 个 CLI 检索命令（search / explain / snapshot / status / init）
- Outcome 可视化（session brief 显示 "✓ verified by N test passes"）
- Stale 检测告警
- Outcome 时间线（`pmr explain` 展示证据链 + score 变化）
- Session checkpoint（生成、注入、branch/file digest 级重建校验）
- Skill 文件引导 Claude 使用 `pmr` 命令
- 命令观察结构化 metadata（`command_name / duration_ms / touched_files / stdout_digest / stderr_digest / artifact_ref`）
- SQLite 并发安全（busy_timeout + retry）
- 性能索引（claims, outcomes, transitions, events, checkpoints）

本地验证：

- Node `>=20`
- `pnpm run test`
- `pnpm run benchmark:runtime`

---

## 从哪里开始读

如果你第一次进入这个仓库，推荐阅读顺序：

1. [Contract Index](./docs/planning/contract-index.md)
2. [V2 Design](./docs/planning/2026-03-12-project-memory-kernel-design-v2.md)
3. [Identity And Scope v1](./docs/planning/identity-and-scope-v1.md)
4. [State Machine v1](./docs/planning/state-machine-v1.md)
5. [Schema v1](./docs/planning/schema-v1.md)
6. [Claim Family Registry v1](./docs/planning/claim-family-registry-v1.md)
7. [Adapter Contract v1](./docs/planning/adapter-contract-v1.md)
8. [Evaluation Protocol v1](./docs/planning/evaluation-protocol-v1.md)
9. [Compiler And Ingestion v1](./docs/planning/compiler-and-ingestion-v1.md)

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
