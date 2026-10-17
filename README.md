# McOptimum · 麦麦最优解

> 基于**麦当劳官方 MCP** 的跨渠道 × 跨资产最优下单引擎。
> 不做「猜你爱吃什么」的推荐，而是回答一个更难、更值钱的问题：**同样一餐，怎么买最划算，且券真的能用。**

同一份「巨无霸 + 中杯可乐」，实测在阜新某门店：

| 渠道 | 商品 | 运费 | 打包费 | 实付 |
| --- | --- | --- | --- | --- |
| 到店自取 | ¥36.00 | — | — | **¥36.00** |
| 麦乐送 | ¥40.00 | ¥6.00 | ¥1.10 | **¥47.10** |

> 同款餐跨渠道差 **¥11.10（+30.8%）**。这个数字不是估算，来自 MCP `calculate-price` 的真实返回（记录见 [docs/SMOKE_TEST_REPORT.md](docs/SMOKE_TEST_REPORT.md)）。

---

## 1. 它解决什么问题

麦当劳的 MCP 有 35 个工具，但真实下单决策要同时跨越四层，缺一层就会「看着便宜、结账变贵」：

1. **商品层**：`productCode` **跨渠道不通用**（巨无霸到店 `1100` / 外送 `901100`），必须先做商品实体对齐才能比价。
2. **渠道层**：到店 / 麦乐送 / 团餐的菜单、运费、打包费、营业与预约时段都不同；得来速在某些账号下根本没有数据（实测 `600047` / `600050`）。
3. **资产层**：**领到券 ≠ 能用券**。券可用性是「门店 × 渠道 × 商品 × 时段」四维约束，实测当前账号 3 张券在目标门店全部不可核销（`600012`）。
4. **组合层**：套餐换选（`diffPrice`）、特调（去酱/去冰）、预算与热量约束，都会改变最终解。

McOptimum 把这四层一起求解，输出 **3 套可比方案 + 优惠拆解 + 解释链 + 可直接下单的 order draft**，并且默认 **dry-run**。

---

## 2. 核心能力

| 能力 | 说明 | 依赖的 MCP 工具 |
| --- | --- | --- |
| 跨渠道商品对齐 | 按名称归一化把同款商品对齐，解决 productCode 不通用 | `query-meals` × N 渠道 |
| 同款比价 | 每个候选组合都用官方核价，含运费/打包费/优惠 | `calculate-price` |
| 券核销判定 | 钱包券 × 渠道 × 商品 × 时效四维判定，**下单前**给出可用/不可用及原因 | `query-my-coupons`、`query-store-coupons`、`calculate-price` |
| 组合优化 | 套餐 / 主食+饮品 / 主食+小食，受预算、热量、必含商品硬约束 | `query-meals`、`query-meal-detail`、`list-nutrition-foods` |
| 渠道降级 | 得来速探测失败自动降级，不把业务错误当异常 | `query-nearby-stores`、`delivery-query-stores` |
| 解释链与可回放 | 每次决策留脱敏 trace（tool / 参数 / 业务码 / 耗时） | 全部 |
| 成本护栏 | 单请求核价调用上限 + 剪枝，避免无边界调用 | `calculate-price` |
| dry-run 下单 | 只生成 order draft，不提交；真实下单需显式确认 | `create-order`（默认不调用） |

### 为什么这是「优化」，不是「推荐」

- 候选由规则生成（套餐/组合），**价格全部由 `calculate-price` 复核**，模型不编价格。
- 目标函数明确：满足硬约束下总实付最小；同价时按渠道偏好 tie-break。
- 输出可验证：每个方案给出商品明细、运费、打包费、优惠、热量、调用链。

---

## 3. 安装

```bash
git clone <your-repo-url> mcd-optimum
cd mcd-optimum
npm install        # 或 pnpm install
cp .env.example .env.local
```

环境变量（详见 `.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `MCD_MODE` | `mock`（默认，无需凭据）或 `live`（直连真实 MCP） |
| `MCD_MCP_URL` | 麦当劳 MCP Server 地址，如 `https://mcp.mcd.cn` |
| `MCD_MCP_TOKEN` | 你的 MCP Bearer Token，**只放本机环境变量** |
| `MCD_DEFAULT_STORE_CODE` | 默认门店编码 |
| `MCD_DEFAULT_ADDRESS_ID` | 外送渠道用的配送地址 ID（属个人数据，不要提交） |
| `MCD_PRICE_CALL_BUDGET` | 单请求核价调用上限，默认 32 |

> ⚠️ **任何情况下都不要把真实 token、cookie、手机号、地址、couponId/couponCode 提交到仓库。** 仓库的 `.gitignore` 已屏蔽 `.env*`、`mcp-config.json`、`cordis.patch.yml` 等文件。

## 4. 使用示例

### 4.1 离线演示（mock，无需凭据）

```bash
npm run dev
# 打开 http://localhost:3000
```

mock 模式使用 `fixtures/` 中的**脱敏真实快照**（来自 2026-10-17 的实测响应），渠道费用、商品价、券不可用结论都按真实数据复现，因此评委 clone 后可以直接看到完整决策过程。

### 4.2 直连真实 MCP

```bash
MCD_MODE=live MCD_MCP_TOKEN=<your-token> npm run dev
```

### 4.3 命令行冒烟测试（只读）

```bash
MCD_MCP_TOKEN=<your-token> node scripts/smoke.mjs
```

只调用只读工具，输出全部脱敏，可安全贴进 issue。

### 4.4 调用优化接口

```bash
curl -X POST http://localhost:3000/api/optimize \
  -H 'content-type: application/json' \
  -d '{"storeCode":"3230323","budgetYuan":"35","maxKcal":"900","mustContain":["汉堡"]}'
```

返回结构（节选）：

```jsonc
{
  "mode": "mock",
  "plans": [
    {
      "channelLabel": "到店自取",
      "quote": { "totalCents": 2250, "productCents": 2250, "deliveryCents": 0, "packingCents": 0 },
      "items": [{ "name": "麦辣鸡腿汉堡", "priceCents": 2250, "kcal": 485 }],
      "savingsVsChannelCents": 1010,
      "explanation": ["到店自取实付 22.50 元 …", "同款组合在其它渠道最高需 32.60 元，本方案省 10.10 元"],
      "orderDraft": { "orderType": 1, "beType": 1, "takeWayCode": "take-in-store" }
    }
  ],
  "couponProbes": [{ "coupon": { "title": "9.9元中杯冰美式" }, "usable": false, "reason": "当前优惠券不可用！(600012)" }],
  "diagnostics": ["得来速不可用（600047 …），已自动降级", "同款价差：大堡口福三件套 到店 22.90 元 vs 麦乐送 28.90 元，差 6.00 元"],
  "trace": [{ "tool": "calculate-price", "ok": true, "latencyMs": 1 }]
}
```

## 5. 目标用户

| 用户 | 痛点 | 本项目的价值 |
| --- | --- | --- |
| **预算敏感的学生 / 上班族** | 想吃麦麦但不想多花钱，懒得比价 | 一键给出「最省且能吃到目标商品」的方案，含券核销判定 |
| **家庭 / 多人点单** | 平台券、会员券、套餐换选规则复杂 | 组合优化 + 热量约束，避免「凑单反而更贵」 |
| **企业团餐组织者** | 人数、预算、满减规则叠加 | 团餐渠道参与比价（实测 `beType=6` 可用，`beCode` 与麦乐送不同） |
| **健康管理人群** | 想吃但怕热量超标 | 以营养表做硬约束，输出热量合计与明细 |
| **开发者 / 参赛评审** | 想验证「是否真的用了 MCP」 | 全链路 trace 可回放，mock 模式可无凭据复现 |

## 6. 仓库结构

```
.
├── README.md                     # 本文件（介绍 / 安装 / 使用 / 目标用户）
├── CONTEST_DECLARATION.md        # 参赛声明（原创性 / 合规性 / 敏感信息）
├── MCP_INTEGRATION.md            # 麦当劳 MCP 集成说明（工具 / 流程 / 业务价值）
├── mcp-config.example.json       # 脱敏 MCP 配置示例（仅环境变量占位符）
├── workbuddy.md                  # WorkBuddy 专项：对话上下文
├── docs/
│   ├── PRD.md                    # 需求、范围、8 天排期、验收标准
│   └── SMOKE_TEST_REPORT.md      # MCP 连通性与数据契约实测报告
├── fixtures/                     # 脱敏真实快照（mock 模式数据源）
├── scripts/smoke.mjs             # 只读冒烟测试
└── src/
    ├── app/                      # Next.js 页面与 /api/optimize
    ├── domain/                   # 领域核心
    │   ├── catalog.ts            #   跨渠道商品实体对齐 + 营养模糊匹配
    │   ├── channels-meta.ts      #   渠道元数据（beType/orderType/券标签映射）
    │   ├── gateway.ts            #   数据网关接口（mock / live 同构）
    │   ├── live-gateway.ts       #   直连真实 MCP
    │   ├── mock-gateway.ts       #   离线 fixtures 网关
    │   └── optimizer.ts          #   候选生成 + 核价复核 + 券层 + 解释链
    ├── lib/                      # 类型、单位（分/元）、env
    └── mcp/                      # MCP 客户端（streamable-http / JSON-RPC）与脱敏 trace
```

## 7. 质量与验证

```bash
npm run typecheck   # TypeScript 严格模式
npm test            # vitest 单元测试（商品对齐 / 营养匹配 / 单位换算）
npm run build       # Next.js 生产构建
npm run smoke       # 真实 MCP 只读冒烟（需 token）
```

本地实测结果（2026-10-17）：

- `tsc --noEmit` 通过（0 error）
- `vitest run`：2 个测试文件 / 7 个用例全部通过
- `next build`：构建成功（`/` 静态、`/api/optimize` 动态）
- mock 端到端：3 个方案，到店 ¥22.50 vs 麦乐送 ¥32.60（省 ¥10.10），16 次工具调用
- live 只读冒烟：18 个工具调用成功（详见 `docs/SMOKE_TEST_REPORT.md`）

## 8. 设计取舍（诚实说明）

- **积分 / 抽奖不作为核心路径**：实测当前账号 `availablePoint=0`、抽奖 `resourceEligible=false`，因此不承诺「积分兑换最优」的执行链路，只保留资产体检与预警的设计位。
- **得来速不保证可用**：实测该账号无 DT 门店数据（`600047`/`600050`）。项目实现的是「探测 + 自动降级」，而不是假设它一定存在。
- **券的结果可能全部不可用**：这是真实业务结论，不是失败。系统把它作为**决策信息**展示，而不是隐藏。
- **不绕过任何官方限制**：不做并发刷券、不做价格伪造、不代他人下单；所有写操作默认 dry-run。

## 9. 合规与致谢

- 本项目为参赛作品，与麦当劳官方无隶属关系；「麦当劳」「麦乐送」等为其权利人商标，本项目仅作技术演示。
- 所有真实 MCP 数据在落盘前经过脱敏（凭据、手机号、地址、券码、账号 ID 一律移除），详见 [CONTEST_DECLARATION.md](CONTEST_DECLARATION.md)。
- 依赖开源项目：Next.js、React、Tailwind CSS、Vitest。许可证见 [LICENSE](LICENSE)（MIT）。
