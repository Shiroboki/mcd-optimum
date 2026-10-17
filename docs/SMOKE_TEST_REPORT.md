# McOptimum 冒烟测试报告（MCP 连通性与数据契约实测）

- 实测时间：2026-10-17 14:21–14:24（GMT+8）
- 实测账号：本次会话绑定的麦麦会员账号（已脱敏，`availablePoint=0`）
- 实测门店：麦当劳阜新人民大街友谊商城餐厅 `storeCode=3230323`
- 实测方式：直接调用麦当劳官方 MCP（共 35 个工具），只做**只读 / 试算**，未触发任何下单、取消、抽奖、兑换等写操作
- 结论摘要：**方案两条原假设被真实数据推翻**，P0 范围已据此收敛（见 §5）

---

## 1. 渠道可用性矩阵

同一门店 `storeCode=3230323`，四个 `beType` 实测结果：

| 渠道 | beType | 入参 beCode | 可用性 | 关键证据 |
|---|---|---|---|---|
| 到店自取 | 1 | **不传**（传了会报错） | ✅ 可用 | `query-meals` 返回约 130 个餐品；`calculate-price` 返回 `takeWayList=[eat-in, take-in-store]` |
| 得来速 DT | 5 | 待查 | ❌ **不可用** | `searchType=1` 报 `600050 收藏餐厅列表为空`；`searchType=2`（阜新/阜新市 + 万达广场/人民大街）两次均报 `600047 附近没有找到合适的餐厅` |
| 麦乐送 | 2 | `323032302` | ✅ 可用 | `delivery-query-stores(beType=2)` 返回门店 + beCode + 营业时段；`calculate-price` 返回运费与打包费 |
| 企业团餐 | 6 | `323032381` | ✅ 有门店与预约时段 | `delivery-query-stores(beType=6)` 返回**另一套 beCode**，并带 7 天 `reservationTimeOptions` |

> **重要**：同一门店在麦乐送与团餐下的 `beCode` **不相同**（`323032302` vs `323032381`），绝不能跨 `beType` 复用。

**对方案的影响**：原设计「自提 / 得来速 / 麦乐送」三渠道比价 → 实际应改为「**到店自取 / 麦乐送 / 团餐**」，且得来速必须实现**探测失败自动降级**（不能把 600047 当异常崩溃）。

---

## 2. 跨渠道比价的真实收益（核心 demo 数据）

同一份餐：**巨无霸 + 中杯可乐**

| 渠道 | 商品编码 | 商品金额 | 运费 | 打包费 | 合计 |
|---|---|---|---|---|---|
| 到店自取 | `1100` 巨无霸 + `9900008751` 可乐 | 26.5 + 9.5 | — | — | **¥36.00** |
| 麦乐送 | `901100` 巨无霸 + `903050` 可口可乐中杯 | 29 + 11 | 6.0 | 1.1 | **¥47.10** |

**同款餐差 ¥11.10（+30.8%）**。这是用真实 MCP 返回计算的，不是估算——「跨渠道比价」这个产品命题成立且可量化。

返回结构要点（`calculate-price`，金额单位全部是**分**）：

```json
{
  "productOriginalPrice": 4000, "productPrice": 4000,
  "deliveryOriginalPrice": 600, "deliveryPrice": 600,
  "packingOriginalPrice": 110, "packingPrice": 110,
  "originalPrice": 4710, "discount": 0, "price": 4710,
  "productList": [
    {"productCode": "901100", "productName": "巨无霸", "quantity": 1, "originalSubtotal": 2900, "subtotal": 2900},
    {"productCode": "903050", "productName": "可口可乐中杯", "quantity": 1, "originalSubtotal": 1100, "subtotal": 1100},
    {"productCode": "920174", "productName": "打包服务费", "quantity": 11, "originalSubtotal": 110, "subtotal": 0}
  ]
}
```

> **陷阱**：`productList` 里混入 `920174 打包服务费`，做金额归一化时必须剔除，否则重复计入。

---

## 3. 商品编码跨渠道不通用（必须建实体对齐表）

实测 4 组同物不同码：

| 商品 | 到店渠道 code | 麦乐送渠道 code |
|---|---|---|
| 巨无霸 | `1100` | `901100` |
| 可口可乐中杯 | `9900008751`（可乐，¥9.5） | `903050`（可口可乐中杯，¥11） |
| 板烧鸡腿堡 | `1406` | `901406` |
| 麦辣鸡腿堡 | `1440` | `901440` |

- 到店菜单里**根本不存在** `9900013304 人气经典随心配` 的外送版本，反之外送有「麦麦周末」「麦金卡专享」等渠道专属分类。
- 结论：**不能按 productCode 跨渠道匹配**，必须建「商品实体对齐表」——按 `name` 归一化 + 品类 + 规格（中杯/大杯）+ 人工确认表兜底。这是本方案真正的技术门槛，也是与「只做到店推荐」的参赛作品拉开差距的地方。

---

## 4. 券与资产：领到 ≠ 能用

| 实测项 | 结果 |
|---|---|
| `query-my-coupons` | 3 张可用券：9.9 中杯冰美式（¥9.9，到店+外送）、人气麦旋风买一送一（¥15，仅到店，10:00–22:00）、巧克力味厚松饼猪柳蛋套餐（¥29.9，仅到店，周日 05:00–10:29） |
| `query-store-coupons(3230323, orderType=1, beType=1)` | 返回 **空数组 `[]`** |
| `calculate-price` 试算麦旋风买一送一（`9900008754`×2 + couponId + couponCode） | 报 `600012 当前优惠券不可用！` |
| `calculate-price` 只传 couponId 不传 couponCode | 报 `600010 使用优惠券需要couponId和couponCode` |

**结论**：
1. 「券可用」是 **门店 × 渠道 × 商品 × 时段** 四维约束，`query-store-coupons` 会返回空/不完整，**不能单点依赖**；必须实现 `calculate-price` 单次试算作为核销判定的兜底 oracle（需缓存 + 剪枝）。
2. 当前 3 张券在该门店**全部不可核销**——这恰好是极好的产品叙事：市面上「领券」工具很多，但没人解决「**领了用不上**」。

**资产现状（影响 P0 边界）**：

| 资产 | 实测值 | 结论 |
|---|---|---|
| 可用积分 | `availablePoint=0`（累计 1068.9，已过期 287.9，已用 781） | ❌ 积分兑换演示不了 |
| 抽奖 | `drawDecision.resourceEligible=false`，原因「积分不足」，24 积分/次，27 个奖品 | ❌ 抽奖执行演示不了 |
| 积分商城 | 商品可查（50–800 分），但很多 `status=2` 而 `downTime` 已过（如「18.8元2份麦辣鸡翅」`downTime=2026-03-21`） | ⚠️ 必须按 `upTime/downTime` 过滤，**不能信 status** |

---

## 5. 对 P0 范围的修正（已确认）

### 5.1 删除/降级项
- ❌ **删掉"积分兑换 + 抽奖"作为核心执行路径** → 降级为**资产体检与预警**（有积分才给兑换建议，0 积分也能跑通 demo）。
- ❌ **删掉得来速为主渠道** → 改为「探测 + 自动降级」，文档如实写明"本账号无 DT 门店数据"。
- ⚠️ 三渠道比价 → 定为 **到店 / 麦乐送 / 团餐（laboratory 级）**。

### 5.2 保留并加强项
| P0 能力 | 依据 |
|---|---|
| **跨渠道商品实体对齐 + 同款比价** | §2、§3 实测差价 ¥11.1 与 4 组编码错位 |
| **券四维核销判定（试算 oracle）** | §4 空数组 + 600012 双重证据 |
| **组合微优化**：套餐 rounds 换选 + 特调 diffPrice | 实测 `随心配` 蓝区 7 选项（`diffPrice` -¥1~+¥0）、粉区 14 选项；特调 `selectedKey/unselectedKey` 规则明确 |
| **时段硬约束** | `businessStartTime/EndTime` + `reservationTimeOptions`（下午茶 15:00–17:29 / 夜市 17:30–21:30）实测可得 |
| **dry-run + 二次确认下单** | 写类工具本次一律未触发，安全性设计必须前置 |

### 5.3 P1 候选（8 天内视进度）
- 营养约束：`list-nutrition-foods` 实测 160 条（含 energyKcal/protein/fat/carb/sodium/calcium），但**品名与菜单 name 不一致**（"中薯条" vs "薯条"/"脆脆薯条"），需模糊对齐 + 人工映射表。
- 资产预警：券过期 / 积分将过期（`currentMouthExpirePoint` 等字段可得）。
- 团餐多人分摊：`beType=6` 已确认可用，`query-meal-assistance` 待测 `gmServiceCode`。

---

## 6. 已实测可用的工具清单（18 个）

`now-time-info`、`query-my-coupons`、`query-store-coupons`、`available-coupons`、`auto-bind-coupons`、`query-my-account`、`query-lottery-info`、`query-my-prizes`、`campaign-calendar`、`query-nearby-stores`、`delivery-query-addresses`、`delivery-query-stores`、`query-meals`、`query-meal-detail`、`calculate-price`、`list-nutrition-foods`、`mall-points-products`、`query-meal-detail`

**未触发（故意不测）**：`create-order`、`cancel-order`、`draw-lottery`、`mall-create-order`、`mall-order-list/detail`、`order-list`、`query-order`、`delivery-create-address`、`party-*`、`query-promotions`、`query-meal-assistance`、`query-survey-coupon`
→ 写类与交易类工具在 D5 用 dry-run + 显式确认后再验证，避免冒烟阶段误下单/误扣积分/误创建地址。

---

## 7. 关键工程约束清单（写进代码规范）

1. **双单位体系**：`calculate-price` 全部分 → 内部统一存「分」，展示层除以 100；`query-meals.currentPrice` 是「元」字符串 → 解析即转分。
2. **券下单必须 `couponId` + `couponCode` 双传**（600010），`couponCode` 属敏感凭据，**禁止入库/入日志**。
3. **到店下单必须传 `takeWayCode`**（取自 `takeWayList[].code`，如 `take-in-store`）。
4. **`selectKey` 规则**：含 `unselectedKey` 的特调组必须整组传，选中项用 `selectedKey`、未选中用 `unselectedKey`。
5. **渠道感知**：`productCode`、`beCode`、菜单、运费/打包费规则都随 `orderType`/`beType` 变化，任何缓存 key 必须包含 `storeCode + orderType + beType`。
6. **失败即降级**：`600047`（无门店）、`600050`（无收藏）、`60006`（商品不可售）、`600012`（券不可用）都要作为**业务分支**处理，不是异常。
7. **定价 oracle 预算**：单请求 `calculate-price` 调用上限（建议 ≤ 40 次）+ LRU 缓存 + 组合剪枝，并把调用次数做成可观测指标（评审加分项）。
8. **脱敏**：`accountId`、`addressId`、`phone`、`fullAddress`、`couponCode`、`couponId` 一律不得写入 fixtures / 日志 / 文档。

---

## 8. 结论如何落到交付物

1. **技能本体**：本报告的结论已逐条写入 [`SKILL.md`](../SKILL.md)（三条铁律、7 步协议、常见坑、不要做的事）。
2. **计算脚本**：商品对齐与排序在 [`scripts/mcd-optimize.mjs`](../scripts/mcd-optimize.mjs) 实现，单测覆盖预算/热量/券透出/预估标记。
3. **工具契约**：字段与错误码整理进 [`references/mcp-tools.md`](../references/mcp-tools.md) 与 [`references/pricing-and-coupons.md`](../references/pricing-and-coupons.md)。
4. **可选演示**：`demo/`（Next.js）复用同一套决策逻辑，mock 模式用本报告 `demo/fixtures/` 的脱敏快照零凭据复现。
5. **提交前动作**：建公开仓库 → 填写 `CONTEST_DECLARATION.md` 个人信息 → 补 `workbuddy.md` 真实对话 → 跑一遍脚本单测与 demo 构建。
