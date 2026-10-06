# Luna + max 请求修复与受控复测

## 正确语义与配置

模型 ID 是 `gpt-6-luna`，推理等级是 `max`。之前要求把 `/max` 保留在模型 ID 中的说明错误，现已撤回；本次不得换模型或降级推理。

网关固定为 `https://sub2api.154.89.153.24.sslip.io/v1`，三个直接探测及原生 DSH provider 均发送 `/v1/responses`。不关闭 TLS、不回退明文 HTTP、不跟随重定向、不自动重试或切换接口。

```json
{
  "model": "gpt-6-luna",
  "reasoning": { "effort": "max" },
  "stream": true,
  "store": false,
  "max_output_tokens": 4096,
  "include": ["reasoning.encrypted_content"],
  "input": [{"role": "user", "content": [{"type": "input_text", "text": "..."}]}]
}
```

原生 overlay 同时配置默认模型、七对主影的 `reasoningEffort: max`，以及 pi-ai provider 的 `reasoning: max`、`transport: sse`、模型能力映射 `reasoningEfforts: {max: max}`。真实 native wire 测试必须检查最终网络请求，而不是只检查 JSON 配置。SDK 可能另外加入 `reasoning.summary: auto`；它不会降低 effort。

Responses 使用 SSE 解析；只有 `response.completed` 且状态 completed 才通过。`[DONE]`、文本片段或 HTTP 200 本身不足以通过；流截断、failed/incomplete、错误 Content-Type 都停止。工具续传保留完整 output（含 reasoning/encrypted_content 与 call_id），不只回传最终文本。响应声称不同模型时停止，不能默默接受。

## 首先离线验证（不需要密钥）

在 Node 24.21.0、锁定依赖和构建产物就绪的环境中执行：

```sh
node --test alpha/tests/*.test.mjs
node alpha/provider-regression.mjs /absolute/private/provider-check
node alpha/luna-native-smoke.mjs /absolute/private/native-wire --fixture
```

第一项是 Alpha 及请求结构测试；第二项跑完整 345 项 provider 用例，不设置名称过滤或 skip，先验证本地 loopback。它在启动测试子进程之前清理代理变量/Node 启动代理开关及凭证，只影响测试子进程，不改变服务端配置。第三项经过真实 DSH headless、原生子 Agent、pi-ai/Responses 适配器及工具循环，但 HTTP 响应是明确的离线夹具，不算真实 Luna 验收。

直接调用已安装的 `node_modules/vitest/vitest.mjs` 是测试入口，不是业务应用替代入口。避免在迁移过来的 node_modules 上由 pnpm 自动触发重新安装；正常新环境仍使用冻结锁文件安装。

## 单次小额受控真实复测

凭据由安全配置为进程提供 `ALPHA_SMOKE_API_KEY`。不要打印值、写进源码、放入普通配置或命令行参数。还必须提供以下非敏感预算配置：

- `ALPHA_SMOKE_ALLOW_LIVE=1`：明确启用此轮测试。
- `ALPHA_SMOKE_MAX_USD`：大于 0、不超过 0.25；默认 0.25 美元。
- `ALPHA_SMOKE_INPUT_USD_PER_MILLION`、`ALPHA_SMOKE_OUTPUT_USD_PER_MILLION`：由网关实际计费核实的每百万 token 最高费率，不能套用其他服务商价格。未知费率时拒绝付费测试。

```sh
node alpha/luna-controlled.mjs /absolute/private/luna-unique-run-directory
```

输出目录必须为本次新建的独立目录，避免覆盖旧记录。单次顺序如下：普通回复（1 次）→ 强制 echo 函数调用（1 次）→ 工具结果续传（1 次）→ 原生 DSH fresh 子 Agent 的 echo 往返（最多 2 次）。合计最多 **5 次推理 HTTP 请求**，每次最多 4096 输出 token（包括服务商计入该上限的推理 token）、输入请求体最多 32 KiB，零自动重试。任一阶段失败，不执行后续阶段，不运行十四角色团队。

每次请求发送前按请求字节数加协议余量和输出上限进行保守费用预留；原生阶段只获得前三次预留后的剩余预算。此预留是基于配置费率的估算，不是服务商账单硬限额：需要严格账单封顶时，应同时使用网关余额/凭据支出限额。缺少 usage 不记作零用量；超时或失败也可能产生费用，保留预留记录，不擅自退还预算。

`controlled-report.json` 汇总各阶段、调用数、实际返回的 usage、估算和未验收事项。`native-report.json` 是原生调用报告；原生测试根控制器是确定性测试驱动，真正的子 Agent 使用 Luna，不是模型模拟替换。fixture 模式费用和 usage 为合成数据，不能计入真实用量。

## 错误记录与验收边界

记录每次 HTTP 状态、Content-Type、请求摘要、可用的 request-id、时长及 usage。错误正文在脱敏后限长；过大正文只报告截断，避免输出不完整的凭据。成功正文、Authorization、Cookie 和原始 profile 日志不写入报告。

此前真实 404 没有保存正文/Content-Type；这次修复了确定存在的请求差异，但不能认定这些差异是 404 的唯一原因。旧报告不得覆盖。

此前云端 provider 287 通过、58 失败的原始错误栈未随本次需求提供；开发用 Node 24 环境复现为 345/345。该差异尚未归因。需要在云端运行诊断入口，保存标准运行环境下的具体失败项及错误栈。不能以增大所有超时、关闭网络安全或跳过用例制造通过。

所有报告必须分开说明：代码和离线测试、真实调用、用量、未验收范围。fixture/构建/lint 不能替代真实模型验收；五次探测通过也不等于整个阿尔法团队已经业务验收。

## 官方协议参考

- https://developers.openai.com/api/docs/guides/streaming-responses
- https://developers.openai.com/api/reference/resources/responses/streaming-events
- https://developers.openai.com/api/docs/guides/function-calling

## 云端 CI

push 只运行离线检查；不因有 Secret 就自动消费模型。联网依赖/构建/provider 检查同样自动执行，使用固定 Dockerfile 和冻结锁文件。真实复测由工作流手动输入 `run_live=true` 或云端上述命令启用，并提供预算费率；GitHub 使用仓库 Secret `ALPHA_SMOKE_API_KEY`，只上传脱敏报告。
