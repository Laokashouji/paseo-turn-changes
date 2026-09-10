# 每轮改动

Paseo 插件，按一轮 Agent 执行汇总文件改动。在回答后显示文件数量、增删行数和文件列表，点击文件或“审核”查看当轮差异；“撤销”恢复这一轮之前的文件内容。

## 当前状态

- 已在隔离的 Paseo `0.8.0-beta.1` daemon 验证插件安装、两种来源、连续两轮、历史持久化和撤销。
- 默认 Codex 使用原生累计差异，其他执行后端由插件汇总结构化编辑记录。
- Codex 路径需要本仓库的接入补丁；纯插件路径只需要 Paseo 0.8 的生命周期接口。
- 尚未安装到主力 daemon；真实模型会话和真实 Paseo 客户端 UI 尚未验收。自动集成测试使用脚本构造的 provider 事件。

## 界面入口

有改动的轮次结束后，对话中增加一张“已编辑 N 个文件”卡片。没有改动且没有异常时不插入空卡片。文件列表默认显示前六项，可以展开全部。历史卡片的差异保存在生成时，不随后续编辑或 Git 提交变化。

- 点击文件或“审核”：按文件查看红绿行差异，可切换上一个、下一个文件。
- 点击“撤销”：二次确认后撤销整轮。任何文件出现后续修改时，整轮拒绝撤销。
- 工作区的“每轮改动”面板：查看当前 Agent 的历史记录。
- 命令中心：“查看每轮改动”“配置每轮改动来源”。
- 设置 → 插件 → `turn-changes` → 数据来源：设置每个执行后端的来源。

`npm run test:ui` 会生成 `tmp/preview.html`，可直接在浏览器打开。预览使用真实插件组件、模拟数据及简化的宿主弹窗和设置控件；不能替代真实 Paseo 客户端验收。

## 配置

默认值：

```json
{
  "defaultSource": "edits",
  "providers": { "codex": "native" }
}
```

`native` 表示执行后端的原生本轮差异，`edits` 表示插件汇总文件编辑记录。匹配的是 provider ID，不是模型名称。自定义 Codex provider ID 可在设置中单独添加。

设置从下一轮生效，历史记录保留原来源。同一 daemon 的客户端读取同一份配置；旧版本设置的保存会被拒绝，刷新后可重试。数据不足时显示说明，不会静默切换来源。

## 收集范围与撤销

Codex 接入层只保留当前轮次最新的 `turn/diff/updated`，在完成、失败或取消时传给插件，不把差异重复插入普通消息流。

纯插件路径读取本轮最终状态为 `completed` 的结构化文件编辑记录，按文件反向应用本轮操作，计算净变化。同一文件连续修改会合并，修改后又恢复原样的不计入文件列表。开始之前已有的未提交内容不通过 Git 基线覆盖。

以下情况会影响完整性：

- Shell 直接写文件且没有结构化编辑记录时，纯插件路径无法发现；它不等同于整个目录的变化监控。
- `Write` 或编辑记录缺少修改前内容、替换内容无法唯一定位、记录被截断时，不提供自动撤销。
- 暂不自动还原重命名、二进制文件、只有权限变化的记录、符号链接、工作目录之外及 `.git` 内部文件。
- 支持普通 UTF-8 文本及 Git 转义的中文路径。单个文件快照上限 2 MiB，每轮最多 200 个文件、24 MiB 快照总量。
- 插件运行中途重载、缺少开始事件或历史分页不完整时，明确标为记录不完整。安装前的轮次不回填。

原生差异存在而当前文件已经变化时，仍可查看原生补丁及增删行数，但撤销不可用。删除记录缺少原文件权限时也仅供查看。

撤销前检查所有文件的内容和权限，确认仍等于记录结束时的状态；执行期间逐文件复核，失败时尝试恢复已写入的文件，并保留错误状态。工作目录或其父子目录内有正在运行的 Agent 时禁止撤销。撤销不会修改 Git 暂存区、提交或分支。文件系统没有跨进程事务，撤销期间仍应避免编辑器或其他进程同时写文件。

## 存储

默认保存在 `${PASEO_HOME:-~/.paseo}/plugin-data/turn-changes`，可用 `PASEO_TURN_CHANGES_HOME` 指定隔离目录。设置和差异记录使用原子替换写入，文件权限为 `0600`；记录包含修改前后文本。

目录属于运行插件的 daemon，不跨设备自动同步。当前版本不自动清理历史；卸载插件后数据目录仍保留。

## 接入

客户端和 daemon 需要匹配 Paseo 0.8 插件接口；0.7.2 不能直接安装。补丁基于官方 `v0.8.0-beta.1`，提交 `4eab53e24e1b57c74b00945aa48a89d68ed755e3`，见 [patches/codex-turn-diff.patch](patches/codex-turn-diff.patch)。补丁改动 server 内部事件和插件服务端钩子，不修改客户端协议。

在对应 Paseo 源码根目录应用补丁并构建：

```sh
git apply --check /absolute/path/paseo-turn-changes/patches/codex-turn-diff.patch
git apply /absolute/path/paseo-turn-changes/patches/codex-turn-diff.patch
npm ci --ignore-scripts --include-workspace-root --workspace=@getpaseo/server --workspace=@getpaseo/cli --workspace=@getpaseo/client --workspace=@getpaseo/protocol --workspace=@getpaseo/plugin --workspace=@getpaseo/relay --workspace=@getpaseo/highlight
npm run build:server
```

以上仅构建，不替换或重启当前 daemon。切换运行版本需要按目标机器的 Paseo 安装方式操作；有活动会话时先安排切换窗口。桌面和网页客户端也需要匹配版本。

在已运行兼容版本的目标 daemon 上：

```sh
cd /absolute/path/paseo-turn-changes
npm ci --ignore-scripts
paseo plugin install /absolute/path/paseo-turn-changes
```

需事先开启目标 daemon 的插件功能，CLI 也需指向正确主机。多台机器分别安装和配置。

## 开发验证

```sh
npm run typecheck
npm test
npm run test:ui
npx tsx tests/daemon-smoke.mjs /absolute/path/paseo-turn-diff-host
```

集成测试使用随机端口、独立存储和脚本测试后端，不访问主 daemon、真实模型或真实工作文件，结束后关闭临时服务并清理目录。回执在 `tmp/daemon-smoke.json`、`tmp/ui-smoke.json`。

Paseo 补丁测试在其 `packages/server` 下运行：

```sh
npx vitest run src/server/agent/providers/codex-app-server-agent.test.ts --bail=1
```
