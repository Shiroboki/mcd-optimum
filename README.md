# McOptimum · 麦麦最优解（WorkBuddy Skill）

> 一个装在 **WorkBuddy** 里的麦当劳「怎么买最划算」技能：跨渠道比价 + 券核销判定 + 组合优化，默认 dry-run。
>
> 交付形态：**WorkBuddy Skill**（`SKILL.md` + 零依赖脚本 + 参考资料），不是 Web 应用。
> 仓库根目录即技能本体，`demo/` 是可选的本地可视化演示。

同一份「巨无霸 + 中杯可乐」，实测在阜新某门店：

| 渠道 | 商品 | 运费 | 打包费 | 实付 |
| --- | --- | --- | --- | --- |
| 到店自取 | ¥36.00 | — | — | **¥36.00** |
| 麦乐送 | ¥40.00 | ¥6.00 | ¥1.10 | **¥47.10** |

> 同款餐跨渠道差 **¥11.10（+30.8%）**，来自 MCP `calculate-price` 的真实返回，记录见 [docs/SMOKE_TEST_REPORT.md](docs/SMOKE_TEST_REPORT.md)。

---

## 1. 这个 Skill 解决什么问题

麦当劳官方 MCP 有 35 个工具，但真实下单决策要同时跨四层，缺一层就会「看着便宜、结账变贵」：

1. **商品层**：`productCode` 跨渠道不通用（巨无霸到店 `1100` / 外送 `901100`），必须先做商品实体对齐才能比价。
2. **渠道层**：到店 / 麦乐送 / 团餐的菜单、运费、打包费、营业与预约时段都不同；得来速在部分账号下没有数据（实测 `60047`/`60050`）。
3. **资产层**：**领到券 ≠ 能用券**。券可用性是「门店 × 渠道 × 商品 × 时段」四维约束，实测当前账号 3 张券在目标门店全部不可核销（`60012`）。
4. **组合层**：套餐换选（`diffPrice`）、特调（去酱/去冰）、预算与热量约束都会改变最优解。

本 Skill 把四层一起求解，输出 **3 套可比方案 + 逐项拆解 + 券判定 + 解释链 + dry-run 下单草案**，并强制三条铁律：

- 价格只能来自 `calculate-price`（不许估、不许拿菜单价当实付）；
- 跨渠道比价必须先做商品对齐（不许跨渠道用 productCode）；
- 券必须用 `couponId` + `couponCode` 双参数试算才能判可用。

## 2. 安装到 WorkBuddy

WorkBuddy 的用户级技能目录是 `%USERPROFILE%\.workbuddy\skills\`（Windows）或 `~/.workbuddy/skills/`。

```bash
# macOS / Linux
mkdir -p ~/.workbuddy/skills
cp -r ./mcd-optimum-skill ~/.workbuddy/skills/mcd-optimal-order

# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.workbuddy\skills" | Out-Null
Copy-Item -Recurse . "$env:USERPROFILE\.workbuddy\skills\mcd-optimal-order"
```

目录名与 `SKILL.md` 里的 `name: mcd-optimal-order` 保持一致。技能依赖的麦当劳 MCP 需要已在 WorkBuddy 中连接（配置见 [mcp-config.example.json](mcp-config.example.json)，凭据只放环境变量）。

安装后在 WorkBuddy 里直接说人话即可触发：

- 「帮我点麦麦，预算 35，含汉堡，热量别超 900」
- 「我有张麦旋风买一送一，今天能用吗」
- 「外送和自提哪个划算」
- 「两个人吃，控制在 80 以内怎么配」

### 技能目录长什么样

```
mcd-optimal-order/
├── SKILL.md                      # 技能本体：触发条件、7 步流程、输出格式、踩坑清单、禁止事项
├── scripts/
│   └── mcd-optimize.mjs          # 零依赖计算脚本：商品对齐 / 候选生成 / 方案排序 / Markdown 报告
├── references/
│   ├── mcp-tools.md              # 35 个 MCP 工具的真实契约、错误码、降级策略
│   ├── pricing-and-coupons.md    # 金额口径、券判定、省额算法、错误示范
│   └── fixtures/                 # 可直接喂脚本的脱敏示例输入
└── README.md                     # 本说明（安装与验证）
```

## 3. 怎么工作（Skill 负责决策，脚本负责算）

```
用户这句话
   │
   ├─ Skill 指令里定义的 7 步协议
   │   ① 落参（门店/预算/热量/必含）   ② 渠道探测（4 个调用，DT 失败即降级）
   │   ③ 分渠道拉菜单                 ④ 商品对齐（脚本或规则）
   │   ⑤ 候选生成与剪枝               ⑥ calculate-price 官方核价
   │   ⑦ 券四维核销试算 → 输出 3 套方案
   │
   └─ scripts/mcd-optimize.mjs（确定性计算，不联网）
        输入：Skills 从 MCP 拿到的 JSON
        输出：对齐表 / 方案排名 / 金额拆解 / Markdown 报告
```

关键设计：**模型不碰价格算术**。价格由 MCP `calculate-price` 给，排序与拆解由脚本算，模型只负责「按协议调对工具、把结果讲清楚」。

### 本地验证脚本（评审可复现）

```bash
# 跨渠道商品对齐 + 价差表（无需凭据）
node scripts/mcd-optimize.mjs --align --format md --input references/fixtures/align-input.example.json

# 方案排名（示例数据里含真实核价结果与券不可用结论）
node scripts/mcd-optimize.mjs --plan --format md --input references/fixtures/plan-input.example.json

# 单元测试（node 内置 runner，9 个用例）
node scripts/mcd-optimize.test.mjs
```

输出示例（节选真实运行）：

```
**结论**：最省是【到店自取】¥22.50，比其它渠道同款最多省 ¥10.10。
| # | 渠道 | 组合 | 商品 | 运费 | 打包 | 券 | 实付 | 热量 | 核价 |
| 1 | 到店自取 | 麦辣鸡腿汉堡 | ¥22.50 | ¥0.00 | ¥0.00 | 无 | ¥22.50 | 485 kcal | ✅ 官方核价 |
| 3 | 麦乐送 | 麦辣鸡腿汉堡 | ¥25.50 | ¥6.00 | ¥1.10 | 无 | ¥32.60 | 485 kcal | ✅ 官方核价 |

券核销判定（来自 calculate-price 试算，不是「券包显示可用」）：
- 9.9元中杯冰美式 → ❌ 当前优惠券不可用！(600012)
```

## 4. 可选：本地可视化 demo

想直观看到「方案卡 + 券判定 + 调用链」的，可跑 `demo/`（Next.js，与 Skill 共用同一套决策逻辑的 TS 实现）：

```bash
cd demo
npm install
npm run dev     # http://localhost:3000 ，默认 mock 模式，无需任何凭据
```

demo 默认 `MCD_MODE=mock`，使用 `demo/fixtures/` 里 2026-10-17 的脱敏真实快照；切 live 需要 `MCD_MODE=live` + `MCD_MCP_TOKEN`。配置项见 [demo/.env.example](demo/.env.example)。

> demo 不是比赛要求的交付物，仅作演示补充；Skill 本体零依赖、零构建。

## 5. 目标用户

| 用户 | 痛点 | Skill 提供的价值 |
| --- | --- | --- |
| 预算敏感的学生 / 上班族 | 想吃麦麦但不想多花钱，懒得比价 | 一句话给出最省且满足约束的方案，含券是否真能用的判定 |
| 家庭 / 多人点单 | 平台券、会员券、套餐换选规则复杂 | 组合优化 + 热量约束，避免「凑单反而更贵」 |
| 企业团餐组织者 | 人数、预算、满减规则叠加 | 团餐渠道参与比价（实测 `beType=6` 可用，`beCode` 与麦乐送不同） |
| 健康管理人群 | 想吃但怕热量超标 | 以营养表做硬约束，输出热量合计与明细 |
| 开发者 / 评审 | 想验证「是否真的用了 MCP」 | 协议步骤、工具契约、错误码、脱敏 trace 全部可核对 |

## 6. 已验证的事实（2026-10-17 实测）

| 结论 | 证据 |
| --- | --- |
| 同款餐跨渠道差 ¥11.10（+30.8%） | `calculate-price` 到店 `price=3600` vs 外送 `price=4710` |
| `productCode` 跨渠道不通用（4 组） | 巨无霸 `1100`/`901100`、可乐 `9900008751`/`903050`、板烧 `1406`/`901406`、麦辣 `1440`/`901440` |
| 券包 3 张券在目标门店全部不可用 | `query-store-coupons` 返回 `[]`；麦旋风试算 `600012` |
| 券必须双参数 | 只传 couponId → `600010` |
| 得来速在该账号无数据 | `600050` / `600047`，已实现自动降级 |
| 积分资产为 0，抽奖不可用 | `availablePoint=0`、`resourceEligible=false` |
| 打包服务费混在 productList | `920174` 行已含在 `price`，归一化需剔除 |

完整记录：[docs/SMOKE_TEST_REPORT.md](docs/SMOKE_TEST_REPORT.md)；工具契约：[references/mcp-tools.md](references/mcp-tools.md)。

## 7. 质量与验证

```bash
node scripts/mcd-optimize.test.mjs   # 9 个用例：对齐 / 预算 / 热量 / 券透出 / 预估标记
node scripts/mcd-optimize.mjs --align --input references/fixtures/align-input.example.json
node scripts/mcd-optimize.mjs --plan  --input references/fixtures/plan-input.example.json

cd demo && npm run typecheck && npm test && npm run build   # 可选 demo 的工程验证
```

实测结果：脚本单测 9/9 通过；demo `tsc --noEmit` 0 error、vitest 7/7 通过、`next build` 成功、mock 端到端 3 套方案。

## 8. 仓库结构

```
.
├── SKILL.md                      # ★ 技能本体（WorkBuddy Skill 入口）
├── scripts/
│   ├── mcd-optimize.mjs          # ★ 零依赖计算引擎（对齐 / 候选 / 排序 / 报告）
│   └── mcd-optimize.test.mjs     # 单测（node:test）
├── references/
│   ├── mcp-tools.md              # MCP 工具契约与错误码
│   ├── pricing-and-coupons.md    # 金额与券口径
│   └── fixtures/                 # 示例输入
├── README.md                     # 本文件
├── CONTEST_DECLARATION.md        # 参赛声明（原创性 / 合规性 / 敏感信息）
├── MCP_INTEGRATION.md            # MCP 集成说明（工具 / 流程 / 业务价值）
├── mcp-config.example.json       # 脱敏 MCP 配置示例（仅环境变量占位符）
├── workbuddy.md                  # WorkBuddy 专项：真实对话上下文
├── docs/
│   ├── PRD.md                    # 需求、范围、排期、验收
│   └── SMOKE_TEST_REPORT.md      # MCP 实测报告
└── demo/                         # 可选可视化演示（Next.js，非交付必需）
    ├── src/                      #   页面 / API / 领域实现
    └── fixtures/                 #   脱敏真实快照（mock 数据源）
```

## 9. 设计取舍（诚实说明）

- **积分 / 抽奖不作为核心路径**：实测账号 `availablePoint=0`、抽奖 `resourceEligible=false`，因此不承诺「积分最优」的执行链路，只保留资产体检设计位。
- **得来速不保证可用**：实测无 DT 门店数据，Skill 里定义的是「探测 + 自动降级」，不是假设它存在。
- **券可能全部不可用**：这是真实业务结论，被作为**决策信息**输出，而不是隐藏。
- **脚本不联网**：Skill 的定价完全依赖 MCP，脚本只做确定性计算；没有核价结果时会标「⚠️ 预估」，绝不伪装成实付。
- **不绕过官方限制**：不并发刷券、不伪造价格、不代他人下单；写操作默认关闭。

## 10. 合规与致谢

- 本作品为「麦当劳 × WorkBuddy 程序员创意开发大赛」参赛作品，与麦当劳官方无隶属关系；「麦当劳」「麦乐送」等为其权利人商标，本项目仅作技术演示。
- 所有真实 MCP 数据在落盘前经脱敏（凭据、手机号、地址、券码、账号 ID 一律移除），详见 [CONTEST_DECLARATION.md](CONTEST_DECLARATION.md)。
- 依赖：Node.js ≥ 20（脚本零依赖）；可选 demo 使用 Next.js / React / Tailwind CSS / Vitest。许可证 [MIT](LICENSE)。
