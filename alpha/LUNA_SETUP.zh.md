# Luna 单模型通路配置

`luna.gateway.json` 保存用户指定的网关地址与准确模型别名 `gpt-6-luna/max`。不保存密钥，不擅自删除 `/max`、替换模型或改变推理等级。该网关的模型身份、价格、Responses API 支持情况必须通过实际调用确认。

七对主影统一绑定同一路由。`single-model-smoke` 是显式诊断模式，不能算作异模型独立审核；正常建队仍拒绝同模型配对。模式限制同时运行一对、最多21次子委派、不自动返工。委派数不是HTTP请求数，也不是美元硬预算。

## 检查和启动

以环境变量提供 `ALPHA_SMOKE_API_KEY`，在 Node 24 环境执行：

```sh
node alpha/luna-smoke.mjs /absolute/private/luna-check
```

脚本生成十四个岗位的绑定及 dsh 覆盖配置，先检查HTTP连通性；有凭证时最多再执行三次推理请求，验证普通回复、函数调用和工具结果续传。无凭证时状态为 `credential_required`，推理请求为零，不能算模型测试成功。报告中的 `teamRun=false` 表示还未实际运行团队。

依赖和构建产物齐全时，从支持的 profile 启动：

```sh
pnpm dsh --profile headless --patch /absolute/private/luna-check/private/overlay.json
```

先调用 `alpha_preflight`，再调用 `alpha_build_team`。私有配置只保存环境变量引用，不保存密钥。原来的 DeepSeek 模型和付费搜索被禁用；可用明确提供的公开资料URL做全文读取测试。

## GitHub Actions

`dsh930 Luna configuration and gateway check` 使用标准仓库 Secret `ALPHA_SMOKE_API_KEY`。没有 Secret 时只进行代码和HTTP检查，不把聊天中的密钥写入公开工作流。脚本、测试响应和配置通过检查不等于真实模型运行通过。

当前地址是用户重复确认的明文HTTP地址，不应用于发送未公开源码、生产凭证或敏感项目资料。建议服务商提供HTTPS；`allowInsecureHttp` 只适用于这一明确配置。
