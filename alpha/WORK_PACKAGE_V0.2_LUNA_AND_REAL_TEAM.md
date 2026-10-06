# DSH Alpha v0.2 可执行工作包

状态：原生研究单对离线切片已验收；真实链路、研究质量与业务试跑仍待授权及执行
分支：feat/alpha-luna-smoke
基线提交：32692ccecc86ed6ba0aa63ac80a9542126a713fb

## 2026-10-06 原生研究单对离线切片收口

此小节更新本切片状态；下方原阶段计划及历史阻塞保留，不将离线结果提升为真实模型或业务质量验收。

- 已验收代码：[`c61f0a6fc3fa43bd7a76a6c476ac4eb256b6701a`](https://github.com/wmqfl861/dsh930/commit/c61f0a6fc3fa43bd7a76a6c476ac4eb256b6701a)，直接父提交为 `6114c265825b97b7aca6780e1e4b48cb74579d5d`
- 新增原生 `alpha_research_pair` 工具，复用现有运行器、执行器与 RunStore；不依赖 integrator，不另建执行或持久化架构
- 本地 Alpha 115 项测试、完整提交检查和 6 个原生离线场景通过：研究成功、取消、失败、live-disabled 拒绝、跨 child 证据拒绝与旧全队流程；包含相应清理和锁释放检查
- 研究单对为 2 个逻辑角色、3 次委派，审核绑定具体草稿版本；旧全队 7 对、21 次委派回归保留
- [CI 37451568333](https://github.com/wmqfl861/dsh930/actions/runs/37451568333) 绑定上述代码 SHA，offline/provider 作业均成功
- [AKS 云端验收记录](https://github.com/wmqfl861/dsh930/issues/10#issuecomment-6014703075)

本切片仅证明确定性模型/网页夹具下的原生工具分发、子会话、证据隔离及生命周期。零真实 API 调用、未读取密钥；没有授予真实研究质量、异模型效果或生产接受结论。

第一阶段真实链路复测及第二/三阶段真实研究、业务团队试跑仍待执行。进入真实验证前，须有具体研究简报、用户批准的模型绑定与工具范围、核实费率和明确预算/执行授权；持有凭据或文档中的金额/请求数上限本身不构成授权。本次收口不触发任何真实调用。

历史 provider 287/58 的原始失败日志已随旧执行环境消失，本轮不能补称原环境完整归因；后续 345/345 的离线成功与历史失败分别保留。历史真实 404 未因本切片通过而关闭。

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
