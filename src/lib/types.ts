import type { Cents } from '@/lib/units';

/** 渠道标识。实测结论：同一门店在不同 beType 下 beCode 不同，到店(beType=1)不传 beCode。 */
export type ChannelId = 'dine_in' | 'delivery' | 'group_meal' | 'drive_thru';

export interface ChannelSpec {
  id: ChannelId;
  label: string;
  shortLabel: string;
  beType: 1 | 2 | 5 | 6;
  orderType: 1 | 2;
  requiresBeCode: boolean;
  /** 该渠道额外费用描述（用于解释链） */
  feeNote: string;
}

export interface ChannelAvailability {
  channel: ChannelId;
  available: boolean;
  beCode?: string | null;
  storeCode: string;
  storeName?: string;
  businessHours?: { start: string; end: string };
  /** 不可用时的业务码，例如 600047 / 600050（不是异常） */
  failureCode?: number;
  failureMessage?: string;
  /** 预约/时段窗口，解释链会用到 */
  timeWindows?: string[];
}

export interface ProductEntity {
  channel: ChannelId;
  productCode: string;
  name: string;
  /** 菜单展示价（元字符串转来的分） */
  priceCents: Cents;
  originalPriceCents: Cents;
  category: string;
  tags: string[];
  discountType?: string;
  canWithOrder?: boolean;
}

/** 跨渠道对齐后的「同一件商品」。productCode 跨渠道不通用，必须靠名称归一化对齐。 */
export interface AlignedProduct {
  key: string;
  name: string;
  byChannel: Partial<Record<ChannelId, ProductEntity>>;
}

export interface ChannelMenu {
  channel: ChannelId;
  storeCode: string;
  products: ProductEntity[];
}

export interface PriceLine {
  productCode: string;
  productName: string;
  quantity: number;
  originalSubtotalCents: Cents;
  subtotalCents: Cents;
}

export interface PriceQuote {
  channel: ChannelId;
  productCents: Cents;
  deliveryCents: Cents;
  packingCents: Cents;
  totalCents: Cents;
  discountCents: Cents;
  lines: PriceLine[];
  takeWayList?: Array<{ code: string; title: string }>;
  /** 已享受 / 可享受的优惠信息（有则透出） */
  enjoyed?: { amountType: string; realDiscount: number; balanceCents?: Cents };
  enjoyable?: { amountType: string; realDiscount: number; balanceCents?: Cents };
}

export interface PriceRequest {
  storeCode: string;
  channel: ChannelId;
  beCode?: string | null;
  items: Array<{ productCode: string; quantity: number; couponId?: string; couponCode?: string }>;
  reservationDate?: string;
  needTableware?: boolean;
}

export interface CouponAsset {
  title: string;
  couponId: string;
  couponCode: string;
  usePriceCents?: Cents;
  /** 例如 ['到店专用'] / ['到店专用','外送专用'] */
  channelTags: string[];
  validFrom?: string;
  validTo?: string;
  timeWindow?: string;
  source: 'wallet' | 'store';
}

export interface CouponProbe {
  coupon: CouponAsset;
  usable: boolean;
  reason?: string;
  code?: number;
  /** 试算得到的实付金额（可用时） */
  totalCents?: Cents;
  savingsCents?: Cents;
}

export interface Nutrition {
  name: string;
  energyKcal: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  sodium: number;
}

export interface Intent {
  storeCode: string;
  addressId?: string;
  budgetCents?: Cents;
  maxKcal?: number;
  /** 硬约束关键词，例如 ['汉堡']、['鸡腿'] */
  mustContain?: string[];
  /** 期望份数（1 = 单人餐） */
  servings?: number;
  /** 渠道偏好（靠前的优先） */
  channelPreference?: ChannelId[];
  preferCoupon?: boolean;
}

export interface PlanItem {
  productCode: string;
  name: string;
  quantity: number;
  priceCents: Cents;
  kcal?: number;
}

export interface Plan {
  id: string;
  channel: ChannelId;
  channelLabel: string;
  storeCode: string;
  beCode?: string | null;
  items: PlanItem[];
  quote: PriceQuote;
  coupon?: CouponProbe;
  totalKcal?: number;
  /** 相对「同款在另外渠道的正常价」省下的金额 */
  savingsVsChannelCents?: Cents;
  score: number;
  explanation: string[];
  /** 下单所需参数（dry-run 时只展示，不提交） */
  orderDraft: {
    storeCode: string;
    orderType: 1 | 2;
    beType: 1 | 2 | 5 | 6;
    beCode?: string | null;
    takeWayCode?: string;
    addressId?: string;
    items: Array<{ productCode: string; quantity: number; couponId?: string; couponCode?: string }>;
  };
}

export interface OptimizationResult {
  mode: 'mock' | 'live';
  intent: Intent;
  plans: Plan[];
  couponProbes: CouponProbe[];
  diagnostics: string[];
  trace: TraceEntry[];
  elapsedMs: number;
}

export interface TraceEntry {
  at: string;
  tool: string;
  args: unknown;
  ok: boolean;
  code?: number;
  message?: string;
  latencyMs: number;
  note?: string;
}
