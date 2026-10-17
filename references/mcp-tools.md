# 麦当劳 MCP 工具契约（实测版）

> 来源：2026-10-17 对麦当劳官方 MCP（`streamable-http`，35 个工具）的真实调用。
> 只记录**实测确认**的行为；未验证的一律标注「未验证」。凭据/个人信息已脱敏。

## 0. 通用约定

- 金额：`calculate-price` 返回的**全部是「分」**；`query-meals.currentPrice` 是**「元」字符串**。内部统一转分。
- 业务失败不是异常：返回 `{success:false, code, message}`，要按分支处理。常见码见 §9。
- `storeCode` 与 `beCode` 必须成对且渠道匹配；`beCode` 由探测接口返回，不要自己拼。

## 1. 渠道探测

### query-nearby-stores
```
{ beType: 1|5, searchType: 1|2, city?, keyword? }
```
| beType | 含义 | 备注 |
| --- | --- | --- |
| 1 | 到店自取 | 返回的门店无 `beCode`，后续调用**不传** beCode |
| 5 | 得来速 | 返回带 `beCode` |

- `searchType=1` 用收藏门店；为空报 `600050`。
- `searchType=2` 需要 `city` + `keyword`；找不到报 `600047`（实测阜新/阜新市 + 万达广场/人民大街均失败 → 该账号可能无 DT 门店）。
- 返回值含 `reservation` 与 `reservationTimeOptions`，可用来告知用户可预约时段。

### delivery-query-stores
```
{ beType: 2|6, addressId }
```
- 必须先用 `delivery-query-addresses` 拿 `addressId`。
- **同一门店不同 beType 的 beCode 不同**（实测 `beType=2 → 323032302`，`beType=6 → 323032381`）。
- 返回 `businessStartTime/businessEndTime` 与 `reservationTimeOptions`。

## 2. 菜单

### query-meals
```
到店:  { storeCode, orderType: 1, beType: 1 }
麦乐送: { storeCode, orderType: 2, beType: 2, beCode }
团餐:  { storeCode, orderType: 2, beType: 6, beCode }
```
返回：
- `data.categories[]`：`{ name, meals: [{ code, tags }] }`（分类与标签）
- `data.meals`：`{ [code]: { name, image, currentPrice, originalPrice, discountType?, canWithOrder?, withOrder? } }`

要点：
- `productCode` **跨渠道不通用**（实测巨无霸 到店 `1100` / 外送 `901100`），换渠道必须重新拉菜单。
- 两渠道分类不同（外送独有「麦麦周末」「麦金卡专享」）。
- `discountType` 取值：`null | 早餐卡优惠 | 促销优惠 | 麦金卡优惠 | 随单购早餐卡优惠 | 随单购麦金卡优惠`。
- `canWithOrder=true` 表示可随单购卡（`withOrder.membershipCode/specId`），价格依赖随单购选择，直接按 `currentPrice` 算会偏差。

### query-meal-detail
```
{ storeCode, orderType, beType, beCode?, code }
```
- 套餐：`data.rounds[]`（如「蓝区」「粉区」），每个 round 有 `minQuantity/maxQuantity/quantity`，`choices[]` 带 `isDefault`、`diffPrice`、`supportModify`。
- 实测「人气经典随心配」蓝区部分选项 `diffPrice` 为 `- ¥1`，粉区多为 `+ ¥0` → 换选是真实的省钱杠杆（上限约 ¥1/份）。
- 特调：`modification.items[].values[]` 带 `selectedKey` / `unselectedKey`。
  **规则**：含 `unselectedKey` 的特调组，下单选价时必须**整组传**：选中项用 `selectedKey`，未选中项用 `unselectedKey`。
- 单品 `supportModify` 为 true 时商品名后加「【可特调】」。

## 3. 核价（唯一的实付口径）

### calculate-price
```
{
  storeCode, orderType, beType, beCode?,
  items: [{ productCode, quantity, couponId?, couponCode?, modification?, roundList? }],
  reservationDate?, needTableware?, withOrder?
}
```
返回 `data`：

| 字段 | 含义 | 注意 |
| --- | --- | --- |
| `productPrice` / `productOriginalPrice` | 商品现价/原价 | — |
| `deliveryPrice` / `deliveryOriginalPrice` | 运费 | 外送才有（实测 600 分） |
| `packingPrice` | 打包费 | 外送才有（实测 110 分） |
| `discount` / `price` | 优惠额 / **实付** | 一律以 `price` 为准 |
| `productList[]` | 行级明细 | 外送含 `920174 打包服务费`，归一化要剔除 |
| `takeWayList[]` | 到店取餐方式 | `eat-in` 堂食 / `take-in-store` 外带；下单传 `takeWayCode` |
| `enjoyed` / `enjoyable` | 已享 / 可享优惠 | `balance` 为门槛差额（分） |
| `mealAssistanceList[]` | 团餐助餐服务 | 团餐下单要 `gmServiceCode` |

实测样例（同一餐）：
- 到店 `1100` + `9900008751` → `price=2440`（商品 2440，无运费）
- 外送 `901100` + `903050` → `productPrice=4000, deliveryPrice=600, packingPrice=110, price=4710`

## 4. 券与资产

### query-my-coupons
- 返回券包（标题、用券价、有效期、渠道标签「到店专用/外送专用」）。
- ⚠️ 实测该工具可能返回**面向人阅读的展示文本**而非结构化 JSON；解析失败时应降级为「券包不可结构化读取」，不要猜测券码。

### query-store-coupons
```
{ orderType, beType, storeCode, beCode? }
```
- 返回「该门店该订单类型可用券」。**实测可能返回空数组**，即使用户券包里有券。

### 券核销的正确做法
1. `query-my-coupons` 取 `couponId` + `couponCode`；
2. 按有效期与渠道标签初筛；
3. **必须**用 `calculate-price` 传 `couponId` + `couponCode` 双参数试算：
   - 成功 → 用返回的 `price` 作为实付；
   - `600010` → 少了 couponId 或 couponCode；
   - `600012` → 该券在本门店/商品/时段不可用。

### query-my-account / query-lottery-info / query-my-prizes / mall-points-products
- 实测基线：`availablePoint=0`，`accumulated=1068.9`，`expired=287.9`。
- `query-lottery-info.drawDecision.resourceEligible=false`（积分不足，24 积分/次）→ **不要建议抽奖**。
- `mall-points-products`：存在 `status=2` 但 `downTime` 已过期的商品 → 必须按 `upTime/downTime` 过滤，不能信 `status`。

## 5. 营养

### list-nutrition-foods
- 返回约 160 条，`data` 是**字符串**，格式：
  `"[160]{productName,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  巨无霸,null,2146,513,27,26,42,961,171"`
- 解析：按行、按逗号切；索引 0=名称、3=kcal、4=蛋白、5=脂肪、6=碳水、7=钠、8=钙。
- ⚠️ 品名与菜单不完全一致（「中薯条」vs 菜单「薯条」），需模糊匹配；匹配不到标「未知」。

## 6. 活动

### campaign-calendar
- 返回当月活动（进行中/往期/未来），含活动文案与图片。
- 用途：解释「为什么今天有 9.9 早餐」「某券的时段为何受限」，不是价格来源。

## 7. 写操作（默认不要调用）

| Tool | 触发条件 | 保护 |
| --- | --- | --- |
| `create-order` | 用户**明确确认**下单 | 到店需 `takeWayCode`；外送需 `addressId` + `beCode`；传 `items`（含券双参数） |
| `cancel-order` | 用户明确要求取消 | 需 `orderId` + `cancelReasonCode` |
| `draw-lottery` | 用户明确确认且 `resourceEligible=true` | 消耗积分/次数 |
| `mall-create-order` | 用户明确确认兑换 | 消耗积分；实物需 `addressId` |
| `party-order-create` | 用户明确确认预约 | 涉及线下履约 |

## 8. 尚未验证的工具（如用到需先小成本试）

`query-promotions`（团餐满减规则）、`query-meal-assistance`（团餐助餐服务）、`party-*`（派对城市/门店/日期/场次）、`mall-order-*`、`order-list`、`query-order`、`query-survey-coupon`、`delivery-create-address`。

## 9. 错误码字典

| code | message | 场景 | 处理 |
| --- | --- | --- | --- |
| 60006 | 商品已售罄或不可售，换一个商品或检查orderType/beType | 跨渠道串码、商品下架 | 丢弃该候选 |
| 60010 | 使用优惠券需要couponId和couponCode | 券参数不全 | 补齐双参数 |
| 60012 | 当前优惠券不可用！ | 门店/商品/时段不匹配 | 判为不可用并说明 |
| 60047 | 当前位置附近没有找到合适的餐厅 | DT/城市搜索无结果 | 降级该渠道 |
| 60050 | 收藏餐厅列表为空 | `searchType=1` 无收藏 | 改用 `searchType=2` 或问用户 |
