# 同模型原生建队试跑

此诊断路径须显式启用：根据给定需求生成小型专业团队配置，再通过现有生成团队运行器执行。默认 `team-building` 仍要求不同底层模型。宿主配置 `executionPurpose: "single-model-team-trial"` 必须同时设置 `acknowledgeNoIndependentReview: true`，只配置一个模型路由，并限定为生成团队范围。候选团队不能自行选择执行目的或授予确认。

原生 headless 驱动启动四个全新会话：团队生成、影子预研、主方产出和绑定产出哈希的审查。候选仅允许一个成员、一个步骤且无工具。稳定 operation ID 在生成会话启动前持久化保留；没有重试、媒体生成、安装、发布或自动质量接受。重复启动相同操作会在委派前拒绝；未完成或失败的记录不自动重跑，也不能更换 ID 绕过这一限制。

## 零费用检查

使用仓库支持的 Node 环境及已安装依赖：

```sh
node --test alpha/tests/team-trial.test.mjs
node alpha/team-trial.mjs /absolute/private/new-trial fixture-001 --fixture
```

夹具与真实路径使用相同的原生 CLI、控制器、子会话、工具分发、编译器、运行器和审查绑定，只替换模型适配器。它不验证远端接口或模型质量，不读取密钥文件，不发送模型请求。报告标记为 `fixture_complete`、`paidModelCalls: 0`、`independentReviewConfigured: false` 和 `qualityAcceptanceGranted: false`。

## 实际提供商适配器的接口夹具

`node alpha/team-trial.mjs /absolute/private/new-wire-trial wire-001 --wire-fixture` 保留真实 `llm-pi-ai` 提供商适配器、请求序列化和 SSE 解析。在安装真实请求保护前，预加载的合成传输替换 fetch，不保留网络回退，且只使用虚拟夹具凭据。原有保护检查四次实际由适配器生成的请求；响应及 token 用量均为合成数据。它验证本地请求兼容性和原生编排，不验证远端网关、真实凭据或模型质量。报告包含 `wireFixture: true`、`paidModelCalls: 0`、`usage.synthetic: true`、`usage.inferenceRequests: 0` 和 `usage.fixtureRequests: 4`。测试还验证不完整审查响应保留用量，以及生成方尝试禁用工具时在再次请求传输前失败。两种夹具都使用新建隔离工作目录和 DSH home，避免加载仓库或用户环境文件。

## 用户自行启动真实试跑

现有 `luna.gateway.json` 指定 HTTPS Responses 中转、`gpt-6-luna` 和 `max` 推理；启动器不替换模型或地址。配置只包含引用。用户须安全地将已有密钥提供为启动进程的 `ALPHA_SMOKE_API_KEY` 环境变量，不写入聊天、Git、配置 JSON 或命令行参数。持有密钥本身不构成调用授权。

完成安全凭据步骤后，用户可以在自己的终端明确授权本次有限试跑：

```sh
ALPHA_TEAM_TRIAL_ALLOW_LIVE=1 ALPHA_TEAM_TRIAL_COST_AUTHORIZATION=uncapped \
  node alpha/team-trial.mjs /absolute/private/new-live-trial approved-trial-001
```

`uncapped` 明确承认本次试跑没有金额上限，不改变现有 smoke 或研究预算策略。真实请求保护最多允许四次纯文本推理，仅发往所配置的准确 Responses 地址，每次最多 4096 输出 token，无提供商重试、无重定向。意外工具、地址及额外请求均拒绝。usage 报告只记录真实返回用量；未知价格保持 `monetaryCostUsd: null`，不虚构费率或声称零费用。进程限时十分钟，单次接口限时三分钟；这些限制不是提供商账单硬上限。

真实成功报告标记为 `same_model_trial_reviewed`，含四个不同子会话 ID、生成配置和审查后的产物。这是同模型独立上下文审查，不是异模型审查、生产批准或人工质量验收。授权且带凭据的运行成功前，真实链路仍未验证。报告不复制原始真实 profile 日志；私有 DSH 会话存储仍包含提示词与输出。夹具失败可保留仅含夹具数据的诊断日志。
