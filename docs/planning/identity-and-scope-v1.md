# Identity And Scope v1

**日期：** 2026-03-12  
**状态：** Contract v1  
**作用：** 冻结 project identity、scope、`canonical_key` 与共享边界规则

---

## 1. 目的

这份文档解决四个基础问题：

1. 什么叫“同一个项目”
2. 多 clone / 多 worktree / 多分支之间如何共享项目状态
3. scope 如何表达与匹配
4. `canonical_key` 如何命名，何时覆盖，何时并存

这份文档是后续以下文档的前置依赖：

- `state-machine-v1.md`
- `schema-v1.md`
- `adapter-contract-v1.md`

---

## 2. 设计原则

- **共享优先于局部便利**：只要两个 agent 实际在同一项目上工作，它们应尽可能共享同一份项目级记忆。
- **identity 与 scope 分离**：`project_id` 定义“这是哪个项目”，scope 定义“这条记忆在什么范围内成立”。
- **repo-level truth，workspace-level context**：项目真相以 repo 为主，工作区、worktree、branch 只作为作用域和局部上下文。
- **canonical key 表达主题槽位，不表达完整句子**。
- **覆盖行为必须可预测**：只有同一 `canonical_key` 且作用域兼容时，才允许自动 supersede。

---

## 3. Identity 分层

V1 将 identity 明确拆成四层：

1. `repo_id`
2. `project_id`
3. `workspace_id`
4. `session_id`

### 3.1 `repo_id`

`repo_id` 表示“同一个源代码仓库”的稳定身份。

它应该在以下场景中保持一致：

- 同一个仓库的多个本地 clone
- 同一个仓库的多个 worktree
- 同一个仓库在不同 agent 中被访问

### 3.2 `project_id`

`project_id` 表示 memory kernel 的主共享单元。

规则：

- 单仓库项目：`project_id = repo_id`
- monorepo 子项目：`project_id = repo_id + "::" + subproject_id`

也就是说：

- `repo_id` 是底层仓库身份
- `project_id` 是真正用于 recall / claim / snapshot 的共享边界

### 3.3 `workspace_id`

`workspace_id` 表示某个本地工作副本身份。

它应该在以下场景中不同：

- 同仓库不同 clone
- 同仓库不同 worktree
- 同仓库不同本地路径

它不参与项目级 truth model，只用于：

- 本地调试
- 本地路径映射
- workspace-specific observations

### 3.4 `session_id`

`session_id` 表示单次 agent 会话。

它用于：

- 聚合短期 evidence
- 关联单次操作链
- 构建 session brief

---

## 4. `repo_id` 生成策略

V1 采用 **canonical remote first, local fallback second**。

### 4.1 优先策略：canonical remote identity

如果仓库存在 Git remote，优先使用归一化后的 remote 作为 `repo_id` 源。

推荐优先级：

1. `origin`
2. upstream remote
3. 其他唯一 remote

remote URL 归一化规则：

- 去掉协议差异：`https://github.com/foo/bar.git` 与 `git@github.com:foo/bar.git` 归一化为同一 identity
- 去掉末尾 `.git`
- host 小写
- owner/repo 保留大小写信息但比较时默认大小写不敏感

示例：

```text
git@github.com:slicenferqin/universal-memory-mcp.git
https://github.com/slicenferqin/universal-memory-mcp.git
=> github.com/slicenferqin/universal-memory-mcp
```

### 4.2 fallback：local repository root

如果没有 remote，则使用 git root 路径的稳定标识作为 fallback。

推荐生成方式：

```text
repo_id = "local:" + sha256(realpath(git_root))
```

说明：

- local-only 仓库可以被同机多个 agent 共享
- 不承诺跨机器稳定

### 4.3 fork 与 upstream

fork 默认视为不同 `repo_id`，因为：

- 项目真相可能分叉
- issue / PR / branch 生态不同
- 决策上下文可能完全不同

如果未来需要“fork 继承 upstream 知识”，应通过显式的 cross-project import 实现，而不是复用 `repo_id`。

V1 明确：

- 不做 fork / upstream 自动合并
- 即使存在 upstream remote，仍以当前 checkout 的 canonical remote 作为 `repo_id`
- 跨 fork 共享必须显式导入，不能隐式复用 identity

---

## 5. `project_id` 生成策略

### 5.1 单仓库项目

```text
project_id = repo_id
```

### 5.2 monorepo 子项目

如果仓库包含多个相对独立的子项目，允许通过 `subproject_id` 把共享边界收窄。

推荐生成方式：

```text
subproject_id = normalized repo-relative root
project_id = repo_id + "::" + subproject_id
```

示例：

```text
repo_id = github.com/acme/platform
subproject_id = apps/web
project_id = github.com/acme/platform::apps/web
```

### 5.3 `subproject_id` 识别规则

优先顺序：

1. 显式配置
2. 已知 project root markers
3. 最近工作目录聚类

V1 推荐使用显式配置或稳定规则，不依赖 LLM 推断。

---

## 6. `workspace_id` 生成策略

推荐生成方式：

```text
workspace_id = sha256(realpath(worktree_root))
```

说明：

- 不同 worktree 必须有不同 `workspace_id`
- 不同 clone 必须有不同 `workspace_id`
- 同一 worktree 在路径不变时应稳定

---

## 7. Scope 模型

scope 采用由粗到细的层级：

1. `project-wide`
2. `repo`
3. `branch`
4. `cwd_prefix`
5. `files`

### 7.1 Scope 语义

- `project-wide`：整个项目共享，由 **空 scope** 表示
- `repo`：与项目同级，通常用于单仓库项目
- `branch`：仅当前分支生效
- `cwd_prefix`：仅某目录树下生效
- `files`：仅某些文件或模块生效

### 7.2 Scope 匹配原则

默认采用 **most-specific wins, broader-scope falls back**：

- file scope > cwd scope > branch scope > project-wide scope

匹配逻辑：

- file 精确命中时，优先于 branch/project
- cwd 前缀命中时，优先于 branch/project
- branch 命中时，优先于 project
- 空 scope 永远作为 project-wide fallback

### 7.3 Scope 冲突

如果同一 `canonical_key` 在多个 scope 上同时存在：

- 优先使用更具体 scope 的 active claim
- 更宽 scope 的 claim 不自动 supersede，更像 fallback

Recall 默认行为：

- most-specific active claim 优先进入 recall
- broader fallback claim 默认不与其同时展示
- broader fallback claim 仅在 debug / explain 模式暴露

---

## 8. `canonical_key` 规范

`canonical_key` 用来表达“同一个主题槽位”，而不是一整句文本。

### 8.1 命名格式

V1 规范：

```text
<domain>.<entity>.<attribute>[.<qualifier>]
```

约束：

- 全小写
- 点分路径
- 不含空格
- 不直接塞自然语言句子
- 不编码时间戳或 session id

示例：

- `repo.package_manager`
- `repo.test_framework`
- `decision.auth.strategy`
- `workflow.commit.message_style`
- `thread.issue.1234`
- `branch.hotfix.priority`

### 8.2 命名原则

- key 必须稳定，不应随 wording 改变
- key 表达“主题槽位”，不表达“这次说法”
- key 应能被规则生成，而不依赖 LLM 创造性命名

### 8.3 `cardinality`

并非所有 key 都是单值槽位，因此 V1 引入：

```ts
type Cardinality = "singleton" | "set"
```

规则：

- `singleton`：同 scope 下天然互斥，新 claim 可以 supersede 旧 claim
- `set`：同 scope 下允许多值并存，不自动 supersede

示例：

- `repo.package_manager` -> `singleton`
- `repo.test_framework` -> `singleton`
- `thread.issue.1234` -> `singleton`
- `repo.owners` -> `set`
- `workflow.allowed_commands` -> `set`

### 8.4 默认策略

V1 默认采用 `singleton`，除非 schema 明确声明为 `set`。

理由：

- 更保守
- 更易于实现 supersede
- 能减少 recall 噪声

## 8.5 `canonical_key` 生成责任

V1 明确：

- `canonical_key` 的最终生成责任属于 **compiler**
- adapter 不应直接为事件命名最终 key
- adapter 可以通过 metadata 提供高置信 hint
- deterministic extractor 可以直接产出稳定 key
- LLM 仅可在 compiler 受控阶段参与命名建议，不能绕过规则

推荐 hint 字段：

```ts
metadata.memory_hints = {
  canonical_key_hint?: string
  scope_hint?: Record<string, unknown>
}
```

但最终：

- key 是否采用
- key 的 `cardinality`
- 是否与现有 claim 冲突

都由 compiler 决定

---

## 9. `canonical_key` 与覆盖规则

### 9.1 自动 supersede 的条件

只有在以下条件同时满足时，才允许自动 supersede：

1. `project_id` 相同
2. `canonical_key` 相同
3. `cardinality == singleton`
4. scope 兼容
5. 新 claim 置信度不低于旧 claim 的最低门槛

### 9.2 scope 兼容

scope 兼容分两类：

- **同 scope 替换**
- **更具体 scope 覆盖更宽 scope**

示例：

- 同一 branch 下的新 `branch.hotfix.priority` 可 supersede 旧的 branch hotfix priority
- file-level claim 不自动 supersede project-level claim，它只是更具体的 override

### 9.3 不自动 supersede 的情况

以下情况不应自动 supersede：

- `cardinality == set`
- project-level 与 branch-level 的冲突
- branch-level 与 file-level 的冲突
- verification 明显不足的新 claim

这些情况应先进入 conflict review 或 stale path。

---

## 10. Project Identity 与 Git 边界

### 10.1 worktree

同一 Git worktree 共享同一仓库对象库，但拥有独立的工作树、HEAD、index 与 per-worktree metadata。  
因此：

- worktree 不应改变 `repo_id`
- worktree 应改变 `workspace_id`
- branch scope 可以因为 worktree 不同而不同

参考：

- [git-worktree](https://git-scm.com/docs/git-worktree)
- [git glossary: worktree](https://git-scm.com/docs/gitglossary/2.48.0)

### 10.2 branch

branch 不参与 `project_id` 生成，但参与 scope。

原则：

- 分支是局部上下文，不是项目身份
- 分支相关记忆不应污染项目级稳定真相

### 10.3 clone

同仓库不同 clone：

- `repo_id` 相同
- `project_id` 相同
- `workspace_id` 不同

---

## 11. 推荐的 scope 示例

### 11.1 项目级事实

```json
{
  "project_id": "github.com/slicenferqin/universal-memory-mcp",
  "canonical_key": "repo.package_manager",
  "cardinality": "singleton",
  "scope": {}
}
```

### 11.2 分支级线程

```json
{
  "project_id": "github.com/slicenferqin/universal-memory-mcp",
  "canonical_key": "branch.hotfix.priority",
  "cardinality": "singleton",
  "scope": {
    "branch": "fix/windows-install"
  }
}
```

### 11.3 目录级工作流规则

```json
{
  "project_id": "github.com/acme/platform::apps/web",
  "canonical_key": "workflow.test_command",
  "cardinality": "singleton",
  "scope": {
    "cwd_prefix": "apps/web"
  }
}
```

---

## 12. Open Questions Deferred From This Contract

以下问题不在本文件内拍板，由后续文档处理：

- `thread` 是否需要专属 `thread_status`
- stale TTL 如何按 type 配置
- outcome score 的更新公式
- recall token budget 的默认值

---

## 13. Decisions Frozen By This Contract

本合同文档冻结以下决策：

1. `project_id` 是共享边界，不是本地路径边界
2. `repo_id` 优先来源于归一化 remote identity
3. worktree / clone 影响 `workspace_id`，不影响 `project_id`
4. scope 与 identity 分离
5. `canonical_key` 必须稳定、规则化、可比较
6. `cardinality` 必须显式决定是否允许自动 supersede

---

## 14. 参考资料

- [LangGraph Memory Overview](https://docs.langchain.com/oss/javascript/langgraph/memory)
- [LangChain Long-term memory](https://docs.langchain.com/oss/python/langchain/long-term-memory)
- [Mem0 OpenMemory Overview](https://docs.mem0.ai/openmemory/overview)
- [git-worktree](https://git-scm.com/docs/git-worktree)
- [git glossary](https://git-scm.com/docs/gitglossary/2.48.0)
- [Persistent Project Memory Kernel V2](/Users/slicenfer/Development/projects/self/universal-memory-mcp/docs/planning/2026-03-12-project-memory-kernel-design-v2.md)
