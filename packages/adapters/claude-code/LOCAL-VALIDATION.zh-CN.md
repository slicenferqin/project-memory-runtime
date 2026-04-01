# Claude Code 本地验证手册

这份 runbook 用来验证当前 Claude Code reference adapter 的本地闭环。

它的验证范围是刻意收敛的。当前只证明这条链路成立：

- 能把受管的 Claude hook 配置安装到 `.claude/settings.local.json`
- 能校验这些受管 hook 条目是否完整且没有重复
- 能通过真实 hook 驱动把 `PostToolUseFailure` 写入 runtime
- 能在下一次 `SessionStart` 时把有意义的 recall 注入回 Claude

它 **不** 证明下面这些更强的命题：

- 生产级打包和全局 Claude 安装已经完成
- 公共 message API 会直接发出受信任的 `claude_code.hook.*`
- adapter 在更广泛真实场景下已经被充分证明有效

## 前置条件

- Node `20.x`
- `pnpm@9`
- 当前仓库依赖已经安装完成
- 本机已经可以运行 Claude Code
- 所有命令都从仓库根目录执行：
  `/Users/slicenfer/Development/projects/self/project-memory-runtime`

建议先跑一遍基线检查：

```bash
node -v
pnpm -v
pnpm run build
```

预期结果：

- Node 输出 `v20.x`
- `pnpm run build` 成功结束

## 清理本地状态

先清理本地 runtime 和 Claude settings，避免第一次启动就被旧数据污染。

```bash
rm -rf .memory/project-memory
rm -f .claude/settings.local.json
mkdir -p .claude
```

清理后预期：

- 没有 adapter 管理的 runtime DB
- 没有 adapter 管理的 session marker

## 1. 安装 Claude 本地 Hook 配置

执行：

```bash
node ./packages/adapters/claude-code/dist/cli.js install-settings \
  --settings-file .claude/settings.local.json
```

预期结果：

- 命令退出码为 `0`
- `.claude/settings.local.json` 被创建
- stdout 是 JSON，至少包含：
  - `settings_file`
  - `managed_command`
  - `settings.hooks`

当前受管的 hook 事件应当正好包含：

- `SessionStart`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `SessionEnd`
- `PreCompact`

## 2. 校验 Hook 配置是否完整

在打开 Claude 之前，先跑静态校验：

```bash
node ./packages/adapters/claude-code/dist/cli.js validate-settings \
  --settings-file .claude/settings.local.json
```

预期结果：

- 命令退出码为 `0`
- stdout JSON 中 `is_valid` 为 `true`
- `missing_events` 为空
- `duplicate_events` 为空

如果这一步失败，不要继续打开 Claude。先把 settings 修正到通过为止。

## 3. 从当前仓库启动 Claude Code

在这个仓库根目录下启动 Claude Code，并开启一个全新 session。

第一次干净启动时，预期现象通常是：

- Claude 可以正常启动
- 启动时通常 **不会** 出现 `Project Memory` 注入块

如果你在完全 clean start 后第一次启动就看到了 `Project Memory`，通常说明本地状态没有真的清干净。

## 4. 人为制造一次确定性的失败 Tool Observation

在这个 Claude session 里，让 Claude 只执行一条 Bash 命令，不要改代码：

```bash
pnpm test --help >/dev/null 2>&1; echo 'Test failed: Claude hook local validation' >&2; exit 1
```

为什么用这条命令：

- 仍然能命中 adapter 当前的 `pnpm test` 分类逻辑
- 一定失败，可重复
- 会稳定输出 `Test failed: ...`，当前 parser 能把它转成 open thread

预期结果：

- Claude 显示这条 Bash 命令失败
- 本地应当出现 runtime DB：
  `.memory/project-memory/runtime.sqlite`

## 5. 再启动一个新的 Claude Session

结束当前 Claude session，然后在同一个仓库里重新开启一个 **新的** session。

注意是新的 session，不要只是 resume 同一个 session。当前 session brief dedupe 是按 `{project_id, workspace_id, session_id}` 键控的。

预期结果：

- Claude 启动时出现 `Project Memory` 注入块
- 注入文本里包含 `Claude hook local validation`
- 这段 recall 是通过 `SessionStart` 自动注入的，不是靠你手动调用 memory tool

这是这条本地验证链路最核心的成功标准。

## 6. 用 memoryctl 检查 runtime 结果

如果 UI 表现不够确定，直接看 runtime 内部结果。

先求出当前仓库对应的 adapter `project_id`：

```bash
export PM_PROJECT_ID="$(
  node -e 'import("./packages/adapters/claude-code/dist/index.js").then((m) => console.log(m.defaultClaudeProjectId(process.cwd())))'
)"
echo "$PM_PROJECT_ID"
```

预期：

- 有 `origin` 的仓库会得到标准化 repo id，例如 `github.com/acme/demo`
- 纯本地仓库会得到 `local:<sha256>`

查看事件：

```bash
pnpm run memoryctl -- inspect events \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID" \
  --json
```

预期：

- 至少有一条 `session_start`
- 至少有一条 `test_result`

查看 claim：

```bash
pnpm run memoryctl -- inspect claims \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID" \
  --json
```

预期：

- 至少有一条由失败 tool observation 编译出来的 open thread
- 这条 thread 在本次验证流里应当能关联到 `Claude hook local validation`

查看当前 snapshot：

```bash
pnpm run memoryctl -- snapshot \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID"
```

预期：

- `open_threads` 至少为 `1`
- brief 不再是空的

可选的文件系统检查：

```bash
ls -R .memory/project-memory
```

预期：

- 有 `runtime.sqlite`
- 有 `claude-code/session-brief-markers/`

## 通过标准

只有下面这些条件同时成立，才算这轮本地验证通过：

- `install-settings` 成功
- `validate-settings` 返回 `is_valid=true`
- 第一次 clean session 启动时没有假 recall / 脏 recall
- 那条确定性失败的 Bash 命令确实创建了 runtime 存储
- 下一次全新 Claude session 启动时，`Project Memory` 中出现 `Claude hook local validation`
- `memoryctl snapshot` 能看到至少一条属于当前项目的 open thread

## 失败排查

### `validate-settings` 返回 `is_valid=false`

常见原因：

- `.claude/settings.local.json` 被手工改坏了
- 受管 hook 条目被重复写入
- 某些受支持事件缺失

修复方式：

```bash
node ./packages/adapters/claude-code/dist/cli.js install-settings \
  --settings-file .claude/settings.local.json
node ./packages/adapters/claude-code/dist/cli.js validate-settings \
  --settings-file .claude/settings.local.json
```

### `.memory/project-memory/runtime.sqlite` 一直没出现

常见原因：

- Claude 没有实际加载这个仓库下的 `.claude/settings.local.json`
- Claude 不是从这个仓库目录启动的
- hook 命令在真正写 runtime 前就失败了

检查点：

- `.claude/settings.local.json` 是否真的在当前仓库根目录
- 里面的受管 command 是否指向 `project-memory-claude-hook`
- Claude 是否真的是在这个仓库目录里启动的

### 第二个 session 启动时没有 `Project Memory`

先直接查 runtime：

```bash
pnpm run memoryctl -- inspect events \
  --data-dir .memory/project-memory \
  --project "$PM_PROJECT_ID"
```

判断方式：

- 没有 `test_result`：说明 Claude 没走到预期的 Bash tool capture 路径
- 有 `test_result`，但没有有价值的 thread/claim：说明命令输出没有足够稳定地命中当前 parser
- 有有价值的 thread，但没有启动注入：说明第二次启动可能复用了被 dedupe 的 session identity，或者没有走到预期的 `SessionStart`

### 第一次注入有，紧接着重复启动就消失了

这可能是正确行为。当前 session brief dedupe 会把 marker 持久化到：

```text
.memory/project-memory/claude-code/session-brief-markers/
```

如果 packet 没变，而且 session identity 没变，重复启动注入本来就会被压掉。

## 重置并重跑

如果要从头重跑整条验证链：

```bash
rm -rf .memory/project-memory
rm -f .claude/settings.local.json
```

然后从第 1 步重新开始。
