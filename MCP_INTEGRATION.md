# MCP 集成说明（McOptimum Skill）

本文档说明本项目**实际使用**的麦当劳 MCP Server、Tool、调用流程与业务价值，并给出可复核的真实调用证据。
所有数据来自 2026-10-17 的真实调用，敏感字段已脱敏。

---

## 1. 交付形态与分工

本项目交付的是 **WorkBuddy Skill**，不是独立应用。四者分工明确：

| 角色 | 负责什么 | 载体 |
| --- | --- | --- |
| **WorkBuddy** | 宿主 Agent：理解用户意图、按协议调用 MCP、组织最终话术 | 运行环境 |
| **Skill** | 决策协议：什么时候调哪个工具、参数怎么传、结果怎么判、怎么输出、什么不能做 | [`SKILL.md`](SKILL.md) |
| **麦当劳 MCP** | 唯一数据源与**唯一核价口径** | `${MCD_MCP_URL}`（streamable-http） |
| **计算脚本** | 商品对齐、候选生成、排序、金额拆解、Markdown 报告（不联网、不估价格） | [`scripts/mcd-optimize.mjs`](scripts/mcd-optimize.mjs) |

一句话：**MCP 给事实，脚本算账，Skill 管流程，WorkBuddy 说话。**

## 2. 接入方式

| 项 | 值 |
| --- | --- |
| MCP Server | 麦当劳官方 MCP（`serverName: mcd`） |
| 传输协议 | `streamable-http`（JSON-RPC 2.0） |
| 端点 | `${MCD_MCP_URL}`（实际为 `https://mcp.mcd.cn`） |
| 鉴权 | `Authorization: Bearer ${MCD_MCP_TOKEN}`，**只放宿主环境变量** |
| 工具总数 | 35 个（`tools/list` 实测） |
| 本项目已实测 | 18 个（只读 / 试算），见 §3 |
| 脱敏示例配置 | [`mcp-config.example.json`](mcp-config.example.json)（只允许环境变量占位符） |

> Skill 本身不含凭据、不发起网络请求；所有调用由 WorkBuddy 的 MCP 连接完成。

## 3. Skill 实际使用的工具清单

### 3.1 只读 / 试算（已在真实账号验证）

| Tool | 在技能里的位置 | 作用 |
| --- | --- | --- |
| `now-time-info` | 步骤 0 | 券时段、营业时段的判定基准，禁止用模型时间直觉 |
| `query-nearby-stores` | 步骤 1 | 到店（`beType=1`）与得来速（`beType=5`）探测 |
| `delivery-query-stores` | 步骤 1 | 麦乐送（`beType=2`）/ 团餐（`beType=6`）门店与 `beCode` |
| `query-meals` | 步骤 2 | 按渠道分别拉菜单（同商品 `productCode` 不同） |
| `query-meal-detail` | 步骤 4（P1） | 套餐 `rounds` / `diffPrice` / 特调 `selectedKey` |
| `calculate-price` | 步骤 5、6 | **唯一核价口径**：商品/运费/打包费/优惠/`takeWayList` |
| `query-my-coupons` | 步骤 6 | 券包资产与有效期窗口 |
| `query-store-coupons` | 步骤 6（辅助） | 门店可用券；实测可能为空，不能单点依赖 |
| `available-coupons` / `auto-bind-coupons` | 资产体检（P1） | 可领券 / 领券（写操作，需用户同意） |
| `query-my-account` | 资产体检 | 积分余额与过期积分 |
| `query-lottery-info` / `query-my-prizes` | 资产体检 | 抽奖资格与已中奖品（0 积分时只读不改） |
| `campaign-calendar` | 话术补充 | 解释「今天为什么有 9.9 早餐 / 活动截止日」 |
| `list-nutrition-foods` | 步骤 4 | 热量硬约束（160 条营养数据） |
| `mall-points-products` | 资产体检（P1） | 积分商品，须按 `upTime/downTime` 过滤 |
| `delivery-query-addresses` | 前置检查 | 外送渠道地址前置 |

### 3.2 写操作（默认不调用）

`create-order`、`cancel-order`、`draw-lottery`、`mall-create-order`、`party-order-create`、`delivery-create-address`
—— 都会产生真实资金 / 积分 / 履约后果，Skill 明确规定：**必须用户明确确认后才可调用**，默认输出是 dry-run 草案。

## 4. 核心调用流程（与 SKILL.md 的 7 步协议一一对应）

```
用户：「预算 35，含汉堡，别超 900 大卡」
  │
  ├─ 步骤0 落参 + now-time-info                     → 建立时间基准
  ├─ 步骤1 渠道探测
  │     query-nearby-stores(beType=1)              → 到店可用
  │     query-nearby-stores(beType=5)              → 60047/60050 → 降级
  │     delivery-query-stores(beType=2, addressId) → 麦乐送 + beCode
  │     delivery-query-stores(beType=6, addressId) → 团餐 + 另一套 beCode
  ├─ 步骤2 query-meals × 可用渠道                   → 各渠道菜单（productCode 不同）
  ├─ 步骤3 商品对齐（脚本 alignProducts）            → 同款跨渠道映射 + 价差
  ├─ 步骤4 候选生成 + 剪枝（脚本 generateCandidates）→ 套餐/主食+饮品/主食+小食
  │        list-nutrition-foods                     → 热量约束
  ├─ 步骤5 calculate-price × 候选（≤32 次）         → 实付、运费、打包、优惠、takeWayList
  ├─ 步骤6 券四维判定
  │        query-my-coupons                         → 券包 + 时效/渠道标签
  │        calculate-price(couponId + couponCode)   → 可用 / 60012 / 60010
  └─ 步骤7 输出：3 套方案 + 拆解 + 券判定 + dry-run 草案
```

### 4.1 券核销判定（本技能最关键的子流程）

```
券包 query-my-coupons
  ├─ 时效过滤：validTo < now → 已过期（用 now-time-info 的时间）
  ├─ 渠道过滤：券标签含「到店」→ 到店/DT；含「外送」→ 外送/团餐
  └─ calculate-price 试算（couponId + couponCode 必须双传）
        ├─ success=true  → 可用：实付取返回 price，省额 = 无券实付 − 有券实付
        └─ success=false → 不可用：原样告知业务码与原因
             60012 当前优惠券不可用（门店/商品/时段不匹配）
             60010 使用优惠券需要 couponId 和 couponCode
```

### 4.2 dry-run 下单（设计，非默认行为）

Skill 输出 `orderDraft` 所需字段：`storeCode / orderType / beType / beCode / takeWayCode / addressId / items[]`。
到店 `takeWayCode` 取自 `calculate-price` 的 `takeWayList`（`take-in-store`=外带）。
只有当用户明确说「下单 / 确认下单」时才允许调用 `create-order`。

## 5. 真实调用证据（节选，已脱敏）

### 5.1 跨渠道同款价差

```
到店：items=[1100 巨无霸, 9900008751 可乐]        → price=3600（分），无运费
外送：items=[901100 巨无霸, 903050 可口可乐中杯]   → productPrice=4000, deliveryPrice=600, packingPrice=110, price=4710
```

差 **1110 分 = ¥11.10（+30.83%）**。外送 `productList` 含 `920174 打包服务费`，归一时需剔除。

### 5.2 商品跨渠道编码不通用（实测 4 组）

| 商品 | 到店 | 麦乐送 |
| --- | --- | --- |
| 巨无霸 | `1100` | `901100` |
| 可乐 / 可口可乐中杯 | `9900008751`（¥9.5） | `903050`（¥11） |
| 板烧鸡腿堡 | `1406` | `901406` |
| 麦辣鸡腿堡 | `1440` | `901440` |

### 5.3 券不可核销

```
query-store-coupons(3230323, orderType=1, beType=1)  → data: []
calculate-price(9900008754×2, couponId + couponCode)  → 60012 当前优惠券不可用！
calculate-price(仅 couponId)                          → 60010 使用优惠券需要couponId和couponCode
```

### 5.4 渠道降级

```
query-nearby-stores(beType=5, searchType=1)           → 60050 收藏餐厅列表为空
query-nearby-stores(beType=5, searchType=2, 阜新/万达) → 60047 附近没有找到合适的餐厅
→ 判定：该账号无 DT 门店数据，降级，其余渠道继续
```

### 5.5 资产生效状态

```
query-my-account     → availablePoint=0（累计 1068.9，已过期 287.9）
query-lottery-info   → drawDecision.resourceEligible=false，reason=积分不足，24 积分/次
mall-points-products → 存在 status=2 但 downTime 过期的商品（须按时间过滤）
```

## 6. 业务价值

| 价值点 | 量化 | 依据 |
| --- | --- | --- |
| 省钱的可见性 | 同款餐跨渠道最大差 ¥11.10（低价渠道的 ~30%） | §5.1 |
| 减少无效券 | 实测 3/3 张券在目标门店不可用；结账才发现等于白领 | §5.3 |
| 决策可复现 | 协议固定 7 步 + 脚本确定性计算，同一输入得同一结论 | `scripts/` |
| 避免踩坑 | 打包费重复计费、跨渠道串码、过期商城商品、DT 误判 | §5.2 / §5.5 |
| 可审计 | 每一步都能指出「调了哪个工具、返回什么码」，评审可复核 | 本文件 + 实测报告 |

## 7. 安全与合规实现

1. **凭据不进技能**：`SKILL.md`、脚本、参考资料中都没有 token；配置示例只有 `${MCD_MCP_TOKEN}` 占位符。
2. **脱敏**：落盘数据移除账号 ID、地址 ID、手机号、券码；文档中的金额与商品码为公开业务字段。
3. **成本护栏**：单次对话核价调用建议 ≤ 32 次（写进 SKILL.md 步骤 4/5）。
4. **写操作默认关闭**：Skill 明确列出「不要做的事」；demo 也默认 dry-run。
5. **不绕过限制**：不并发刷券、不伪造价格、不代他人下单、不采集他人数据。

## 8. 如何复核（给评审）

```bash
# 1) 只读技能本体：协议、工具契约、踩坑清单
cat SKILL.md
cat references/mcp-tools.md

# 2) 无需凭据复现「算账」逻辑（脚本确定性计算，不联网）
node scripts/mcd-optimize.test.mjs        # 9 个用例
node scripts/mcd-optimize.mjs --align --format md --input references/fixtures/align-input.example.json
node scripts/mcd-optimize.mjs --plan  --format md --input references/fixtures/plan-input.example.json

# 3) 可选可视化 demo（mock 模式，零凭据）
cd demo && npm install && npm run dev     # http://localhost:3000

# 4) 真实 MCP 只读复核（自备 token）
cd demo && MCD_MCP_TOKEN=*** node ../scripts/smoke.mjs
```
