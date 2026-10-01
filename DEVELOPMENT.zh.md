# dsh930 云端二次开发

## 固定开发基线

源码在 `wmqfl861/dsh930`，开发分支为 `dev/cloud-ready`。Node 固定为 `24.21.0`，pnpm 固定为 `12.8.1`，依赖以 `pnpm-lock.yaml` 为准。不要在环境初始化期间执行 `pnpm update`、删除锁文件或运行 `.dsh930/upgrade.mjs`。旧的导入和自动升级工作流保留在 `.github/setup-history/`，不再自动运行。

容器从 Node 官方 `24.21.0-bookworm` 镜像构建，包含 Git、C/C++ 编译器、Python 3、musl 和 Node 头文件。Codespaces 配置请求至少 4 核、16 GB 内存、32 GB 存储；这是该环境的配置要求，不是上游宣称的最低硬件要求。操作系统软件包仍会随 Debian 仓库安全更新变化；没有宣称镜像逐字节可重现。

## 在浏览器里创建开发环境

1. 登录 GitHub，打开仓库并切换到 `dev/cloud-ready`。只有 `main` 已合入同一开发基线时，才从 `main` 创建环境。
2. 选择 **Code → Codespaces → Create codespace**；选择满足配置的机器。创建前查看账户额度和预算，Codespaces 超额使用及存储可能产生费用。
3. 创建日志出现 `Development baseline verified` 才表示初始化成功。创建过程使用 `.devcontainer/setup.sh` 实际执行工具链校验、冻结安装、原生模块构建、干净构建、lint、定向测试和带认证的 Web 冒烟测试。任何一步失败都会停止，不能把终端能打开当作成功。
4. 在 Codespaces 终端执行：

```sh
bash .devcontainer/start.sh
```

该命令使用 `dev:web --skip-build --no-open`，复用已验收的构建并启动源码监听。点击终端打印的完整登录地址，保留 `?token=...`；Codespaces 通常会把 localhost 链接转换为转发地址。若没有转换，复制 **Ports** 中 3080 的地址，保留终端登录 URL 的路径和查询参数。不要分享登录 token，不要将端口改成 Public。匿名访问 Harness 返回 401 是预期行为，不是服务没启动。

新环境的验收记录在 `.artifacts/dsh930-development/READY.json`，各步骤日志在同目录。这里不自动配置模型密钥，也不会为环境验收发起模型 API 请求。真实模型联调需要通过 Codespaces Secret 或根目录中被 Git 忽略的 `.env` 配置 `DEEPSEEK_API_KEY`；不要提交或上传密钥。

## 日常修改和保存

```sh
# 从自己的工作分支开始
git switch -c feat/my-feature
# 运行与改动有关的测试
pnpm exec vitest run packages/<group>/<package>/tests --maxWorkers=2
# 查看改动，再按文件提交
git status --short
git diff
git add <changed-files>
git commit -m "feat: describe the change"
git push -u origin HEAD
```

前端源文件变化由开发命令重建客户端包；对于未被监听的 Host 或配置改动，停止并重新运行启动命令。停止和恢复 Codespace 不等于备份；及时提交并推送。容器重建会重新执行初始化验收。修改依赖、构建配置或拉取新版基线后，应重新运行 `bash .devcontainer/setup.sh`。

## 验收与已知范围

`.github/workflows/dsh930-development.yml` 使用同一 Dockerfile、同一初始化脚本，从新 checkout 开始验收，不恢复历史 `node_modules` 或旧构建产物。它还运行 `.devcontainer/watch-smoke.mjs`，真实修改一个客户端源文件，验证重新编译后通过认证 HTTP 提供的新资源，再恢复源文件并验证恢复结果；测试不会保留这次临时修改。完整回归使用监听器运行前导出的干净构建，避免将开发监听输出当成发布构建。

随后四个独立作业运行完整的 Linux 单元测试清单；任何分片失败会使最终 `Development acceptance` 失败。流程不自动升级依赖，不自动合并到 main，也不把实验性上游项目标记为生产就绪。

容器可用与全量回归通过是两个独立结果：环境检查通过后可以执行开发工作，但在回归全部通过前，分支仍是候选基线。Windows/macOS 原生桌面运行、真实模型 API、单独的 snapshot/e2e/coverage 检查不在该验收声明中。旧 `.dsh930/validation.json` 与 `sandbox-validation.json` 是历史记录，不代表本次提交的结果；以本次提交对应的 Actions 与 READY 记录为准。

本次修复包括客户端 bundle 自引用解析、桌面 pnpm 版本同步、完整本机原生模块构建、pnpm 12 待批准脚本记录读取和 Git 依赖测试迁移，以及依赖升级后的类型图快照更新。依赖脚本仍须明确批准；已有拒绝与过期审批不能被此次迁移绕过。补丁绑定包、原生依赖组和跨主版本升级继续单独处理，不影响先建立冻结开发基线。

## 官方说明

- [Codespaces 开发容器配置](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/introduction-to-dev-containers)
- [机器规格要求](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/configuring-dev-containers/setting-a-minimum-specification-for-codespace-machines)
- [端口转发与访问控制](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
- [Codespaces 计费](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
