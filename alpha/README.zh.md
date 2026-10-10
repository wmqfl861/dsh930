# DSH 阿尔法团队 0.1.0

[English](README.md) | 中文

阿尔法是“研究、组建、试验和交付其他 Agent 团队的团队”，不是视频公司。七对主影共十四个逻辑岗位。总控负责需求与调度；整合者独立；影子从任务开始独立预研。主机运行器是程序，不是额外的第十五个团队岗位。

## 本版交付与状态

本目录交付可执行的编排核心、原生 DSH 子 Agent 适配器、可加载的本地 Cordis 插件、七对岗位配置、十个锁定 Skill，以及确定性测试。它不是只有提示词，也不是十四个已登录模型服务的常驻实例。默认 `liveEnabled=false`；模型池未绑定时明确拒绝调用。当前没有提供真实商业模型的质量或成本对比结果。

原生适配走 `ctx.subagents.start('spawn', ...)`：明确传递 provider/model/maxTokens/persona/toolFilter，拒绝继承父对话的 fork。每对主方和影子必须绑定不同 canonicalModelId；同 provider/model 即使标签不同也拒绝。canonicalModelId 是管理员核验的配置，不保证第三方网关没有隐式路由替换。

## 岗位

| 主方 | 影子 | 边界 |
| --- | --- | --- |
| lead：沟通、需求与调度 | lead-shadow | 不代替整合者 |
| research：领域研究 | research-shadow | 一手资料、反证和时效 |
| architect：团队与流程设计 | architect-shadow | 最小团队、交接、异常与恢复要求 |
| model-lab：模型实验 | model-lab-shadow | 同条件试岗，避免品牌排序 |
| skill-lab：Skill与工具工程 | skill-lab-shadow | 复用、研发、隔离测试需求 |
| integrator：成果整合 | integrator-shadow | 版本一致、缺口透明，不自调度 |
| evaluator：独立验收 | evaluator-shadow | 实际产物与测试，不只听作者自报 |

十四个岗位并不要求十四种不同模型，同一模型可以服务多个岗位。十个 Skill 位于 `.dsh/skills/alpha-*/SKILL.md`：七个专业方法加证据研究、并行审查、能力研发三项共用方法。它们均为本项目编写，未把任何网上候选 Skill 冒充已安装或已验证的第三方能力。

## 不使用密钥的检查

在仓库根目录、Node 24 环境运行：

```sh
node alpha/cli.mjs inspect
node --test alpha/tests/*.test.mjs
node alpha/cli.mjs fixture /tmp/alpha-fixture-runs
node alpha/cli.mjs preflight
```

最后一条针对空配置预期返回退出码 2 和 UNBOUND_PAIR，不能把它改成成功。`fixture` 运行全部七对和 21 次确定性委派（不含修订），结果始终标为 `fixture_complete`，不是真实研究。已安装本仓库依赖和构建产物时还可运行 `node alpha/tests/native-smoke.mjs`：经过真实 DSH CLI、工具分发、子 Agent 生命周期和模型覆盖，响应与网页读取仍是测试夹具，零付费模型调用。

## 接入真实 DSH

1. 在 DSH 本身配置可用的模型 provider 和搜索/全文读取后端；本聊天的 GitHub、搜索和图像工具不会自动成为 DSH 的工具。
2. 将 `models.example.json` 复制到仓库外，按 `BINDING_GUIDE.zh.md` 填写路由引用和七对绑定；密钥只交给 DSH 凭证管理，不写进这个文件。
3. 明确服务商用量预算后，才由管理员开启 `liveEnabled`。
4. 生成可移植到本机路径的覆盖配置，并从支持的 DSH profile 启动：

```sh
node alpha/cli.mjs overlay /tmp/dsh-alpha.overlay.yml
export DSH_ALPHA_CONFIG=/absolute/private/alpha-models.json
export DSH_ALPHA_STATE_DIR=/absolute/private/alpha-runs
pnpm dsh --profile headless --patch /tmp/dsh-alpha.overlay.yml "先运行 alpha_preflight；只有配置完整后，按我的目标调用 alpha_build_team"
```

Web 模式可使用同一覆盖文件，从 `pnpm dsh web --patch /tmp/dsh-alpha.overlay.yml` 启动。Web UI 的按钮/团队看板不是本版新增内容。工具包括 `alpha_preflight`、`alpha_build_team`、`alpha_research_pair` 与 `alpha_execute_team`，不会仅因插件加载就发起模型调用。当前采用前台工具执行，调用取消会取消并等待子运行清理，不是后台长期服务。

## 程序强制的规则

每对任务预留完整批次资源，先将影子预研排入调用，再并行启动主任务；正式审查等待二者，影子预研输入没有主稿。正式审查携带其预研记录和主稿 hash。修订产生新 hash，旧审查不可复用。依赖阶段只接受 reviewed 的上游版本。修订上限、超时、子运行失败、过期审查、未解决风险均不能自动通过。

研究、模型实验、Skill工程的首次主稿和影子预研必须引用该子 Agent 在本次调用中通过原生 `web_fetch` 得到的资料。执行记录由 DSH `tools/result` 事件捕获，按实际 child 身份匹配，不接受他人的抓取或作者伪造的 `_host` 字段。这个门槛仅证明发生过读取，不证明网页内容正确、完整或研究已经深入；深度与专业质量还须影子、业务评测与人工校准。非 2xx 页面可能被上游作为正文返回，仍需审查内容。抓取次数不是质量评分。

所有结果由主机持久化；默认子 Agent 只获得只读网页工具，没有 read/write/bash、安装、发布或递归委派工具。源码编辑、沙箱运行实验等能力只在有合格的受控工具后增加，不能用提示词绕过。需求、模型配置与 Skill 内容在开始时复制并哈希固定。结果写入私有目录，独占锁与原子替换避免静默覆盖。

## 必须保留的限制

- 这是 Alpha 建队与研究编排首版，不是完整生产平台。模型绑定目前由管理员提供，model-lab 可以建议目标团队的选型和新配置，不能在同一运行中擅自修改核心主影绑定。
- 影子预研与审核是同一逻辑岗位的两次 fresh 子运行，后一次显式携带核验资料；没有承诺常驻会话。过程内重大风险即时通报、实时需求变更广播、全局 DAG 恢复和后台运行仍待实现。
- 已有快照和事件记录供诊断；故障后不会自动重放外部操作。遗留锁需确认原进程已停止后由操作员处理。本版不声称 exactly-once 或自动恢复。
- `maxDelegations` 控制子 Agent 委派次数，`maxTokens` 是原生请求配置；它们不是美元总额或总 token 硬上限。真实费用硬限额必须由提供商或受控网关实现。默认不开启付费调用。
- 目前没有给工程岗位任意代码执行或自动安装工具，生成团队可显式调用 `alpha_execute_team` 执行只读任务，但不自动启动业务代码试跑器。它们可提交原型与试验计划，未运行必须标记 not_executed，并保留相应 gap。不能把 JSON 流程校验算作业务端到端验收。
- 无论影子怎么评价，完整运行最多到 `awaiting_human_acceptance`。不包含自动发布/部署/覆盖 main。专业质量、审美、真实模型成本和对 pi 路线的胜负尚未测定。

## 与 pi 路线比较

使用相同简报、可用资源、验收要求和预算；另做相近总成本对照。比较最终生成团队的任务成功率、证据准确性、影子误报/改坏、人工返工和费用。`evals/tasks.json` 是公开开发用例，不是保密测试集；最终盲测由用户提供独立案例，两边互不修改对方工作区。

## 初始验证记录

Node 24.21.0 下，67 项自动测试全部通过，零失败/跳过。独立 MJS lint 检查覆盖 12 个源文件，0 错误、0 警告。原生 DSH headless 集成执行七对岗位、21 次子调用通过，模型和网页后端是确定性测试夹具，不能计作真实多模型研究或业务验收。空配置预检按预期拒绝调用。日志和对应范围见 `reports/validation.json`。

独立检查新增 MJS 文件可用 `node node_modules/oxlint/bin/oxlint -c alpha/oxlint.json --no-ignore alpha --threads 1`；仓库默认 lint 忽略 MJS，因此不能用默认命令未报错代替这项检查。

## 生成团队的实际执行

`alpha_build_team` 仍用七对岗位建设团队；生成团队本身不固定岗位数。将选定产物序列化后通过 `alpha_execute_team` 的 `candidateJson` 参数执行，并提供稳定的 `operationId`（1–128 个字母、数字、下划线或连字符）。重试必须使用原 ID，不能每次生成新 ID。每个 member 必须提供已配置的 `modelRef` 和 `shadowModelRef`、责任描述、已锁定的 skills 和只读 tools；默认建队模式要求不同模型；每个 step 必须有 owner、dependsOn、input、output、check，且当前可执行的 onFailure 仅为 `stop`。未知技能、模型、依赖、循环、未解决 gaps、未使用成员和不足以完成全部任务的预算均在调用子 Agent 前拒绝。

每个 step 生成独立主影任务，步骤数量决定本次 logicalActors。共用同一 member 的多个步骤也使用 fresh 子运行。上游必须完成 hash 绑定的影子审查，才能交给下游。默认主方和影子使用管理员配置的不同模型；不允许用单模型 smoke/research 配置执行生成团队。预算、超时、工具范围和 Skill 内容来自宿主，生成 JSON 不能提高权限或预算。配置 web_fetch 的生成岗位在主稿与影子预研阶段必须各自获得原生抓取凭据，不按岗位名称判断。

宿主显式设置 `executionPurpose=single-model-team-trial` 和 `acknowledgeNoIndependentReview=true` 后，允许只配置一条模型路由来诊断生成团队；团队仅有一个成员、一个步骤，且不提供工具。主方、影子预研和正式审查仍使用 fresh 子上下文，但这不是独立模型审核。报告保留 independentReviewConfigured=false 与 qualityAcceptanceGranted=false。此例外不允许使用单模型执行核心建队。已验证的无密钥路径与真实调用要求见[团队试跑指南](TEAM_TRIAL.md)（[中文](TEAM_TRIAL.zh.md)）。

结果包含 blueprintHash、每个步骤的输出和完整日志，始终保留 qualityAcceptanceGranted=false。只读结构化产物最多到 awaiting_human_acceptance；夹具为 fixture_complete。失败与取消等待已启动任务清理，不自动重跑、安装、写文件或发布。没有跨任务的最终业务质量评测、后台恢复或费用硬限制；这些仍需另行接通和验证。

本路径的离线回归可运行 `node --test alpha/tests/generated-team.test.mjs alpha/tests/adapter.test.mjs`；真实 DSH 组合的确定性场景包含在 `node alpha/tests/native-smoke.mjs`，需要已安装仓库依赖，仍不调用付费模型。离线通过不代表真实模型质量或线上配置已验证。

调用去重记录与运行文件放在同一私有目录。宿主在第一次调用子 Agent 前，以排他创建方式预留 operationId，并持久化绑定蓝图、输入、模型配置、执行模式与版本的 hash；POSIX 还同步目录。相同 ID 与内容已完成时，返回同一结果和运行 ID，不再次调用模型；内容变化则拒绝。运行中、失败、取消、进程崩溃或记录损坏均不自动重跑。只有操作员检查后主动给出新 ID，才开始新尝试。Windows 不支持本实现的目录 fsync，断电持久性不等同于 POSIX。

这是生成团队调用级别的去重，不是外部模型服务的 exactly-once 保证。网络请求可能在进程退出前已被服务商执行；本地未知状态不会被视为安全重试。完成写入失败时同样不自动重复执行。清除或替换整个状态目录会失去历史去重记录，不能作为重试方法。
