# DSH Alpha v0.2 可执行工作包

状态：待云端执行端运行真实复测
分支：feat/alpha-luna-smoke
基线提交：32692ccecc86ed6ba0aa63ac80a9542126a713fb

## 目标

从“Alpha 编排框架通过离线验证”推进到“真实模型链路 + 一个真实主影岗位闭环验证”。

本阶段不运行完整十四岗位团队，不扩大为项目验收。

## 第一阶段：Luna 真实链路验收

固定配置：

- Gateway: https://sub2api.154.89.153.24.sslip.io/v1
- Model: gpt-6-luna
- Reasoning: max
- API: OpenAI Responses
- Stream: true

禁止：

- 修改模型
- 降低 reasoning
- 使用 HTTP
- 自动重试切换接口

执行：

```bash
node alpha/luna-controlled.mjs /absolute/private/luna-run
```

要求：

1. 普通回复成功
2. 函数调用成功
3. 工具结果续传成功
4. 原生 DSH 子 Agent 使用同一配置成功

输出：

- controlled-report.json
- native-report.json
- usage 数据（如果服务返回）
- 脱敏错误报告（如果失败）

## 第二阶段：研究主影真实验证

只启动：

- research
- research-shadow

任务：

研究一个指定领域，输出专业方法和能力需求。

验收：

- shadow 与 primary 并行研究
- shadow 不读取 primary 草稿
- shadow 有独立证据记录
- review 针对具体版本进行

## 第三阶段：生成第一个真实业务团队

通过第二阶段后，再测试：

目标：让 Alpha 根据任务生成一个新的 Agent 团队。

验收：

- 团队配置生成
- Skill 绑定
- 工具需求明确
- 流程可执行
- 新团队完成一次小规模试运行

## 云端环境要求

- Node 24.21+
- pnpm 锁定版本
- DSH 依赖完整安装
- 安全环境变量提供 API key
- 不提交密钥

## 当前阻塞

1. 等待云端真实凭据执行 Luna 受控调用。
2. 历史 provider 失败需要在原失败环境产生诊断证据后归因。
3. 异模型主影组合尚未开始评测。

## 完成标准

本工作包完成后，只代表：

“Alpha 具备真实模型调用能力，并完成一次主影研究闭环。”

不代表：

“Alpha 已经成为通用自主建队系统。”
