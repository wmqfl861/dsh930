# 模型绑定与最小接入信息

本版不硬编码先前讨论过的商业模型名称，不假定服务商、模型版本或推理等级可用。使用你的 DSH 实际提供商路由与服务端模型 ID，至少需要两种经过核验的底层模型。

每个 models 记录只接受以下字段：

| 字段 | 说明 |
| --- | --- |
| id | 本地配置引用，如 writer-a；不是 API 模型名 |
| provider | DSH 已注册 provider 的确切路由名 |
| model | 该服务接受的实际模型 ID |
| canonicalModelId | 管理员核验的真实底层模型标识，跨代理别名保持一致 |
| family | 模型家族，仅作信息记录；跨家族是候选策略，不是强制更好 |
| maxTokens | 正整数；不代表整个研究过程的 token 预算 |
| reasoningEffort | 可选，只填写实际接口支持的值 |

示意配置（占位内容必须替换；不开启 liveEnabled 之前不会调用）：

```json
{
  "schemaVersion": 1,
  "liveEnabled": false,
  "subagentProvider": "spawn",
  "models": [
    {"id":"main-route","provider":"YOUR_DSH_PROVIDER_A","model":"ACTUAL_MODEL_A","canonicalModelId":"ACTUAL_UNDERLYING_A","family":"A","maxTokens":8192},
    {"id":"review-route","provider":"YOUR_DSH_PROVIDER_B","model":"ACTUAL_MODEL_B","canonicalModelId":"ACTUAL_UNDERLYING_B","family":"B","maxTokens":8192}
  ],
  "bindings": {
    "lead":{"primary":"main-route","shadow":"review-route"},
    "research":{"primary":"main-route","shadow":"review-route"},
    "model-lab":{"primary":"main-route","shadow":"review-route"},
    "architect":{"primary":"main-route","shadow":"review-route"},
    "skill-lab":{"primary":"main-route","shadow":"review-route"},
    "integrator":{"primary":"main-route","shadow":"review-route"},
    "evaluator":{"primary":"main-route","shadow":"review-route"}
  }
}
```

不同岗位可使用不同绑定，以上只演示最小模型池，不是选型结果。模型数据解析会拒绝未知字段和密钥字段。不要把 API key、授权 header 或访问 token 放在本文件、聊天记录、Git 或运行报告中；通过 DSH 已有凭证配置引用它们。

真实首测还需要明确：只读搜索后端、全文读取后端、授权的费用上限（在服务商/网关实施）、试点目标及验收条件。未接通的代码执行、图片/视频、外部工具或安装权限仍应保持不可用，而不是以管理员全权限弥补。
