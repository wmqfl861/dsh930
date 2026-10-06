# 首版筹建研究记录

核对日期：2026-10-06。筹建由本会话助手完成研究、代码实现和自查，未声称已启用多个真实商业模型进行相互审核。已有 dsh 基线固定在 7a83cb480fb61a98483cb8c79a37388295a45237。

## 采用与放弃

1. 采用 DSH 原生 subagent/start 的显式模型覆盖、persona 与工具过滤，而非扩展实验性 spawn_teammate。依据本仓库 packages/subagent/subagent/src/types.ts、src/index.ts 与 tool-subagent/src/model-selection.ts：一开始即提供所需能力，避免改动稳定基线和实验团队域。
2. 主影先并行预研，正式审查后置；使用证据记录隔离观点，不让影子预研读取主稿。专业输出与独立判断分开，这仍需真实任务衡量收益，不能宣称必然胜过单 Agent。
3. 十个原创 Skill 使用 Agent Skills 的 SKILL.md 形式；首次运行复制锁定内容，未知新增资源拒绝。没有直接安装网上技能，避免执行未经评估代码。外部 skill-creator 与评测规范只作方法研究，不声称跨平台脚本直接兼容。
4. 对研究能力引入原生全文读取回执；网址列表和模型自述不能独自证明已研究。回执也不代替来源质量和结论核验。
5. 首版默认只读网络，工程实验只允许计划/候选源码；不在未构建隔离工具前提供全能 shell。由此产生的能力缺口必须保留，不能宣称全自动研发已经完成。
6. 先交付候选团队，不自动部署。记录快照但不自动恢复：在没有外部任务幂等与恢复机制前，自动重放可能重复花费或产生副作用。

## 外部方法依据

- Anthropic, How we built our multi-agent research system：https://www.anthropic.com/engineering/multi-agent-research-system 。用于明确独立工作范围、并行探索、从宽到深检索与按结果评测；其中研究任务表现不能外推为阿尔法的质量承诺。
- Agent Skills specification：https://agentskills.io/specification 。用于技能包组织和按需方法，权限由运行时负责而非由Markdown授权。
- Evaluating skill output quality：https://agentskills.io/skill-creation/evaluating-skills 。用于无/有Skill与版本对照、独立任务、人工反馈和成本记录；本版单元测试与模拟试跑并非这种真实业务评测的替代品。
- 用户在本项目确认的七对主影、异模型、同步预研、独立整合和深度研究要求，是本实现的目标，不是外部论文结论。
