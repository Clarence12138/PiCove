# Git 开发与二开习惯

本文约定本仓库的分支管理、提交消息和二次开发方式。

## 1. 分支职责

- `main`：跟随原作者仓库（`upstream/main`）的干净基线，不直接开发个人功能。
- `custom`：个人长期维护的二开分支，保存本地定制、个性化功能以及日常使用的组合版本。
- `fix/*`：修复一个明确问题，通常用于向上游提交 PR。
- `feat/*`：开发一个适合上游的独立功能，通常用于向上游提交 PR。
- `docs/*`、`test/*`、`refactor/*`、`chore/*`：分别用于文档、测试、重构和工程维护。

贡献分支必须从最新的 `main` 创建；个人定制分支不得作为上游 PR 的基础，避免把私人改动带入贡献。

示例：

```text
fix/10-composer-image
feat/10-workspace-alias
custom/keyboard-shortcuts
```

## 2. 上游同步

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

`main` 只做同步，不在上面积累个人提交。开始新的上游贡献前，先同步 `main`。

长期的 `custom` 分支定期合入 `upstream/main`；短期 PR 分支可根据需要 rebase 到最新 `main`。改写已经被多人使用的分支历史前，不要直接强推；确需强推时使用：

```bash
git push --force-with-lease
```

## 3. 提交消息

提交消息使用 Conventional Commits 风格；类型使用英文，描述使用中文，整个仓库保持一致：

```text
<type>: <简短描述>
```

常用类型：

- `feat`：新增功能
- `fix`：修复问题
- `docs`：文档修改
- `test`：测试修改
- `refactor`：不改变行为的重构
- `chore`：依赖、脚本或工程维护
- `ci`：持续集成相关修改

要求：

- 使用祈使、简洁的中文描述，不加句号。
- 一个提交尽量只表达一个逻辑变更。
- 不把无关格式化、重命名或临时调试混入功能提交。

示例：

```text

fix: 修复编辑器粘贴图片失败的问题
feat: 增加工作区显示名称配置
docs: 补充本地开发说明
test: 增加主机状态渲染测试
refactor: 简化工作区初始化流程
```

## 4. 上游贡献流程

1. 从最新 `main` 创建独立的 `fix/*` 或 `feat/*` 分支。
2. 保持改动范围单一，补充必要的回归测试和文档。
3. 推送到自己的 Fork（`origin`）。
4. 向原作者仓库（`upstream`）提交 PR。
5. 根据 Review 继续在原分支提交，PR 会自动更新。

上游 PR 不应包含 `custom` 中的个人主题、快捷键、私有集成或其他个性化内容。

## 5. 二次开发习惯

- 所有个人定制进入 `custom`，不要污染 `main`。
- 较大的个人功能先创建 `custom/<name>`，完成后合入 `custom`。
- 能独立上游的修复，优先从 `main` 单独制作 PR；如果 `custom` 需要提前使用，再将该修复合入 `custom`。
- 与上游同步时优先保留清晰历史，并及时解决冲突、运行测试。
- 不修改或提交本地密钥、认证信息、机器专属配置和构建产物。
- 删除已合并或不再使用的临时分支，保持分支列表清晰。
