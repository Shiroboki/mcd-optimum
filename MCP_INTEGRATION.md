# MCP 集成说明（McOptimum）

本文档说明项目**实际使用**的麦当劳 MCP Server、Tool、调用流程与业务价值，并给出可复核的真实调用证据。
所有示例数据均来自 2026-10-17 的真实调用，敏感字段已脱敏。

---

## 1. 接入方式

| 项 | 值 |
| --- | --- |
| MCP Server | 麦当劳官方 MCP（`serverName: mcd`） |
| 传输协议 | `streamable-http`（JSON-RPC 2.0） |
| 端点 | `${MCD_MCP_URL}`（实际为 `https://mcp.mcd.cn`） |
| 鉴权 | `Authorization: Bearer ${MCD_MCP_TOKEN}`，**仅服务端环境变量** |
| 工具总数 | 35 个（`tools/list` 实测） |
| 本项目已实测 | 18 个（只读 / 试算），见 §2 |
| 客户端实现 | [`src/mcp/client.ts`](src/mcp/client.ts)：initialize + `Mcp-Session-Id` 会话、JSON/SSE 双解析、业务码透传、脱敏 trace |
| 脱敏示例配置 | [`mcp-config.example.json`](mcp-config.example.json)（只允许环境变量占位符） |

调用链会写入 `TraceRecorder`，前端 `展开 MCP 调用链` 可直接查看 tool / 参数（脱敏）/ 业务码 / 耗时。

## 2. 实际使用的 Tool 清单

### 2.1 只读（已实测通过）

| Tool | 用途 | 本项目中的位置 |
| --- | --- | --- |
| `now-time-info` | 服务器时间，用于「券是否在有效时段内」判定 | 冒烟 / 时段约束 |
| `query-nearby-stores` | 到店（`beType=1`）与得来速（`beType=5`）门店探测 | `live-gateway.channels()` |
| `delivery-query-stores` | 麦乐送（`beType=2`）/ 团餐（`beType=6`）门店与 `beCode` | `live-gateway.channels()` |
| `query-meals` | 各渠道菜单（同一商品 `productCode` 不同） | `live-gateway.menus()` |
| `query-meal-detail` | 套餐 rounds / choices / `diffPrice` / 特调 `selectedKey` | 组合优化（P1 特调层） |
| `calculate-price` | **官方核价**：商品/运费/打包费/优惠/`takeWayList` | `live-gateway.tryPrice()`（核心 oracle） |
| `query-my-coupons` | 券包资产与有效期窗口 | `live-gateway.coupons()` |
| `query-store-coupons` | 指定门店+订单类型可用券 | 券四维判定（辅助） |
| `available-coupons` / `auto-bind-coupons` | 麦麦省可领券 / 领券 | 资产体检（P1） |
| `query-my-account` | 积分余额与过期积分 | 资产体检 |
| `query-lottery-info` / `query-my-prizes` | 抽奖资格与已中奖品 | 资产体检（0 积分时只读不改） |
| `campaign-calendar` | 当月营销活动日历 | 场景叙事 / 活动券解释 |
| `list-nutrition-foods` | 160 条营养数据（kcal/蛋白/脂肪/碳水/钠/钙） | 热量硬约束 |
| `mall-points-products` | 积分商城商品与上下架时间 | 资产体检（按时效过滤） |
| `delivery-query-addresses` | 外送地址列表 | 渠道可用性前置 |

### 2.2 写操作（默认不触发）

| Tool | 状态 | 保护措施 |
| --- | --- | --- |
| `create-order` | **默认 dry-run，不调用** | 必须显式传入确认标记后才允许；UI 文案明确「不会真实下单」 |
| `cancel-order` | 未使用 | — |
| `draw-lottery` | 未使用（实测 `resourceEligible=false`） | 消耗积分，禁止自动执行 |
| `mall-create-order` | 未使用 | 消耗积分，禁止自动执行 |

> 设计原则：**读与试算可以自动，写与花钱必须人工确认。** 冒烟阶段完全未触发写操作。

## 3. 核心调用流程

### 3.1 主流程：跨渠道最优解

```
用户意图（预算 / 热量 / 必含商品 / 门店）
        │
        ├─(1) 渠道探测
        │     query-nearby-stores(beType=1)         → 到店可否
        │     query-nearby-stores(beType=5)         → 得来速可否（600047 → 降级）
        │     delivery-query-stores(beType=2)       → 麦乐送 + beCode
        │     delivery-query-stores(beType=6)       → 团餐 + 另一套 beCode
        │
        ├─(2) 菜单加载与商品对齐
        │     query-meals(orderType/beType) × 可用渠道
        │     → 名称归一化（可口可乐≈可乐、去括号后缀、去空格）
        │     → 建立「同款商品」跨渠道映射（productCode 不通用）
        │
        ├─(3) 组合候选生成（规则 + 剪枝）
        │     套餐 / 主食+饮品 / 主食+小食 / 单主食
        │     硬约束过滤：预算、热量上限（list-nutrition-foods）、必含商品
        │
        ├─(4) 官方核价复核（每候选 1 次 calculate-price，受预算护栏限制）
        │     成功 → 进入排序；失败 → 记入 diagnostics（60006 等）
        │
        ├─(5) 券核销判定（下单前）
        │     query-my-coupons → 有效期/渠道标签过滤
        │     calculate-price(couponId + couponCode) 试算
        │       → 可用：计入实付并标「省 ¥X」
        │       → 不可用：记录业务码与原因（600012 / 600010）
        │
        └─(6) 输出
              3~6 套方案 + 优惠拆解 + 解释链 + orderDraft（dry-run）
              控制台可展开完整脱敏 trace
```

### 3.2 券核销判定（本项目最关键的子流程）

```
券包 query-my-coupons
  ├─ 时间过滤：validTo < now → 已过期
  ├─ 渠道过滤：券标签含「到店」/「外送」→ 匹配 beType
  └─ 商品过滤：calculate-price 试算（couponId + couponCode 必须双传）
        ├─ success=true  → 可用（实付金额直接取返回 price）
        └─ success=false → 不可用
             600012 当前优惠券不可用（门店/商品/时段不匹配）
             600010 缺少 couponId 或 couponCode
```

**业务价值**：把「券能不能用」从「结账时才发现」提前到「下单前」，并给出原因。

### 3.3 dry-run 下单（设计，非当前默认行为）

`plan.orderDraft` 已包含 `create-order` 所需的全部字段：
`storeCode / orderType / beType / beCode / takeWayCode / items[]`（到店 `takeWayCode` 取自 `calculate-price` 的 `takeWayList`）。
真实下单需显式开启并二次确认，避免误下单与误扣款。

## 4. 真实调用证据（节选，已脱敏）

### 4.1 跨渠道同款价差

```
calculate-price 到店：items=[1100 巨无霸, 9900008751 可乐]
  → productPrice=3600, originalPrice=3600, price=3600（分）
  → takeWayList=[eat-in, take-in-store]

calculate-price 外送：items=[901100 巨无霸, 903050 可口可乐中杯], beCode=323032302
  → productPrice=4000, deliveryPrice=600, packingPrice=110, price=4710（分）
  → productList 含 920174「打包服务费」（归一时需剔除）
```

差值 **1110 分 = ¥11.10（+30.83%）**。

### 4.2 商品跨渠道编码不通用（实测 4 组）

| 商品 | 到店 | 麦乐送 |
| --- | --- | --- |
| 巨无霸 | `1100` | `901100` |
| 可乐 / 可口可乐中杯 | `9900008751`（¥9.5） | `903050`（¥11） |
| 板烧鸡腿堡 | `1406` | `901406` |
| 麦辣鸡腿堡 | `1440` | `901440` |

### 4.3 券不可核销（真实结论）

```
query-store-coupons(storeCode=3230323, orderType=1, beType=1) → data: []
calculate-price(9900008754 ×2, couponId + couponCode)        → 600012 当前优惠券不可用！
calculate-price(仅 couponId)                                   → 600010 使用优惠券需要couponId和couponCode
```

### 4.4 渠道降级（业务错误不是异常）

```
query-nearby-stores(beType=5, searchType=1) → 600050 收藏餐厅列表为空
query-nearby-stores(beType=5, searchType=2, 阜新/万达广场) → 600047 附近没有找到合适的餐厅
→ 系统判定：该账号无 DT 门店数据 → 该渠道不参与比价，其余流程继续
```

### 4.5 资产生效状态

```
query-my-account → availablePoint=0（累计 1068.9，已过期 287.9）
query-lottery-info → drawDecision.resourceEligible=false，reason=积分不足，24 积分/次
mall-points-products → 存在 status=2 但 downTime 已过期的商品（必须按时间过滤）
```

## 5. 业务价值

| 价值点 | 量化 | 依据 |
| --- | --- | --- |
| 省钱的可见性 | 同款餐跨渠道最大差 **¥11.10**，约为低价渠道的 30% | §4.1 |
| 减少无效券 | 实测 3/3 张券在目标门店不可用；若结账才发现等于白领 | §4.3 |
| 决策时间 | 单次优化 4~16 次工具调用，端到端 < 100 ms（mock）/ 视网络（live） | mock 实测 4 ms |
| 避免踩坑 | 打包服务费重复计费、跨渠道串码下单、过期商城商品、DT 误判 —— 均已在代码层拦截 | §4.2/§4.5 |
| 可审计 | 每次决策留 trace，评审可验证「真的调了 MCP」而不是编数据 | `TraceRecorder` |

## 6. 安全与合规实现

1. **凭据**：仅从 `process.env` 读取；`.env*`、`mcp-config.json`、`cordis.patch.yml` 已在 `.gitignore` 中屏蔽。
2. **脱敏**：`src/mcp/trace.ts` 对 `token/authorization/cookie/couponCode/phone/addressId/accountId` 等键做掩码，并对 `MCD…` 券码、11 位手机号做正则脱敏；fixtures 中相关字段已替换为 `<masked>`。
3. **成本护栏**：`MCD_PRICE_CALL_BUDGET`（默认 32）限制单请求核价次数，超限即停止并返回已得结果。
4. **写操作默认关闭**：`create-order` 不在默认链路中；页面明确标注 dry-run。
5. **不绕过限制**：不做并发刷券、不伪造价格、不代他人下单、不采集他人数据。

## 7. 如何复核（给评审）

```bash
# 1) 无需任何凭据即可复现完整决策（mock 使用真实快照）
npm install && npm run dev        # http://localhost:3000 点「计算最优解」

# 2) 真实 MCP 只读复核（需自备 token）
MCD_MCP_TOKEN=*** node scripts/smoke.mjs

# 3) 查看真实响应快照与错误码语义
cat docs/SMOKE_TEST_REPORT.md
ls fixtures/
```

> 说明：`query-my-coupons`、`query-nearby-stores` 等工具的 MCP 响应包含面向人阅读的展示文本，客户端取其中首个完整 JSON 值；若某工具只返回展示文本（无 JSON），本项目按「该数据源不可结构化读取」降级处理，而不是猜测内容。
