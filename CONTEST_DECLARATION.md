# 参赛声明（CONTEST DECLARATION）

项目名称：**McOptimum · 麦麦最优解**
参赛赛事：麦当劳 × WorkBuddy 程序员创意开发大赛（1024 主题）
参赛者：**（请填写你的姓名 / 昵称）**
GitHub 仓库：**（请填写仓库 URL，并确保公开可访问）**
仓库创建时间：**2026-10-17**（处于 2025-12-25 00:00 至 2026-10-25 23:59 的规定窗口内）
交付形态：**WorkBuddy Skill**（`SKILL.md` 技能本体 + `scripts/` 零依赖计算脚本 + `references/` 参考资料；`demo/` 为可选可视化演示，非交付必需）

---

## 一、原创性声明

1. 本参赛项目（含技能指令 `SKILL.md`、计算脚本、参考资料、文档与演示材料）由参赛者**主导设计与独立完成**，或由参赛者合法拥有使用权、处分权；为在本次赛事期间新编写的原创实现。开发过程中使用了 AI 编程助手（含腾讯 WorkBuddy）辅助撰写与调试，所有内容均经参赛者逐条审阅、并在真实 MCP 环境验证后才采用。
2. 项目**没有直接盗用、复制或改写**任何第三方项目的源代码。开发前的公开资料调研仅用于了解赛题背景与避免选题重复，调研范围包括（列举公开作品，均**未复制其代码**）：
   - `mcd-order-advisor`（WorkBuddy / CodeBuddy 点餐 Skill）
   - `mcd-budget-meal-planner`（预算内组合推荐）
   - 公开技术文章《McAutoPilot》《把 35 个工具串成一条点单流水线》等
   调研结论用于**主动差异化**：上述作品集中在「菜品推荐 / 自动下单」，本项目选择「**跨渠道比价 + 券核销判定 + 组合优化**」这一未被覆盖的决策层。
3. 技能本体（`SKILL.md` + `scripts/mcd-optimize.mjs`）**零第三方依赖**；仅可选演示目录 `demo/` 使用开源依赖（Next.js、React、Tailwind CSS、Vitest 等），均遵循各自许可证，未修改其源码，也未将其作为本项目主要成果宣称。
4. 项目中出现的「麦当劳」「麦乐送」「麦旋风」等名称与商标，仅用于描述所对接的官方 MCP 服务与商品，**不代表与麦当劳官方存在隶属、合作或背书关系**。
5. 若后续引入任何第三方代码片段或数据集，将在本文件中逐项注明来源与许可证。

## 二、合规性声明

1. **真实使用麦当劳 MCP**：本项目通过麦当劳官方 MCP Server（`streamable-http`）完成菜单查询、门店/渠道探测、官方核价、券试算等调用；真实调用证据（工具名、业务码、脱敏参数、耗时）记录于 [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md) 与 [`docs/SMOKE_TEST_REPORT.md`](docs/SMOKE_TEST_REPORT.md)，并在运行时通过 `TraceRecorder` 可回放。
2. **不滥用、不绕过**：项目不绕过官方频率限制、风控与业务规则；不做并发刷券、不伪造价格、不批量注册、不爬取非公开数据、不代他人下单。
3. **写操作最小化**：所有涉及资金或积分的操作（下单、取消、抽奖、积分兑换）默认**不执行**，仅生成 dry-run 草案；真实下单需使用者显式确认。
4. **符合平台条款**：项目仅使用本人账号授权的 MCP 凭据，用于个人/演示用途；不将凭据转借、转售或用于任何商业分发。
5. **内容合规**：项目不含违法违规、色情暴力、赌博欺诈、侵犯他人权益或虚假宣传内容；演示数据均为脱敏后的真实业务字段。

## 三、敏感信息声明

1. **凭据零入库**：`MCD_MCP_TOKEN`、`Authorization`、cookie 等凭据**从不写入仓库**。仓库已通过 `.gitignore` 屏蔽 `.env*`、`mcp-config.json`、`cordis.patch.yml` 等文件；[`mcp-config.example.json`](mcp-config.example.json) 仅含 `${MCD_MCP_URL}`、`${MCD_MCP_TOKEN}` 等环境变量占位符。
2. **个人信息脱敏**：`demo/fixtures/` 与文档中不包含真实手机号、收件人姓名、详细地址、账户 ID、地址 ID。相关字段在落盘前已被替换为 `<masked>` 或直接移除。
3. **券凭据脱敏**：`couponCode`（可核销凭据）与 `couponId` 一律不落盘；真实券码只在运行时内存中使用，且 `src/mcp/trace.ts` 会对 `MCD…` 形态的券码做正则掩码。
4. **日志脱敏**：调用链 trace 在记录时即脱敏（键名匹配 `token/authorization/cookie/couponCode/phone/addressId/accountId` 掩码），因此前端展示与文档引用均可公开。
5. **无第三方用户数据**：项目不采集、不存储、不处理任何第三方用户的个人信息；所有实测均使用参赛者本人账号。

## 四、参赛资格与承诺

1. 参赛者保证其参赛资格符合赛事规则要求，并承诺所提交信息真实、准确。
2. 参赛者承诺参赛仓库在赛事评审期间**保持公开可访问**，且仓库创建时间处于规定窗口内。
3. 参赛者承诺参赛项目为原创或已获得合法授权，若因权属问题产生争议，由参赛者自行承担相应责任。
4. 参赛者同意赛事主办方在赛事宣传、评审、展示等必要范围内使用本项目材料。

## 五、交付物清单

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| 技能本体 | [`SKILL.md`](SKILL.md) | WorkBuddy Skill 入口：触发条件、7 步决策协议、输出模板、踩坑清单、禁止事项 |
| 计算脚本 | [`scripts/mcd-optimize.mjs`](scripts/mcd-optimize.mjs) | 零依赖、不联网：商品对齐 / 候选生成 / 排序 / Markdown 报告 |
| 脚本单测 | [`scripts/mcd-optimize.test.mjs`](scripts/mcd-optimize.test.mjs) | 9 个用例（node:test） |
| MCP 契约 | [`references/mcp-tools.md`](references/mcp-tools.md) | 35 个工具的真实入参、返回字段、错误码、降级策略 |
| 金额与券口径 | [`references/pricing-and-coupons.md`](references/pricing-and-coupons.md) | 分/元、打包费陷阱、券四维判定、省额算法 |
| 项目说明 | [`README.md`](README.md) | 介绍 / 安装 / 使用示例 / 目标用户 |
| MCP 集成 | [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md) | 实际使用的 Server / Tool / 调用流程 / 业务价值 |
| 脱敏配置 | [`mcp-config.example.json`](mcp-config.example.json) | 仅环境变量占位符 |
| WorkBuddy 专项 | [`workbuddy.md`](workbuddy.md) | 真实对话上下文（待补充） |
| 实测报告 | [`docs/SMOKE_TEST_REPORT.md`](docs/SMOKE_TEST_REPORT.md) | 2026-10-17 真实调用证据 |
| 可选演示 | [`demo/`](demo) | Next.js 可视化演示（mock 模式零凭据） |

## 六、待补充信息（提交前请务必填写）

- [ ] 参赛者姓名 / 昵称：
- [ ] GitHub 用户名：
- [ ] 仓库 URL（确认公开）：
- [ ] 联系方式（按赛事要求填写）：
- [ ] 是否参与 WorkBuddy 专项：是（见 [`workbuddy.md`](workbuddy.md)）
- [ ] 演示视频 / 截图链接（如有）：
- [ ] 签署日期：

---

签署人：**（请填写并签署）**
日期：**2026-10-__**
