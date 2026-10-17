import type {
  ChannelAvailability,
  ChannelId,
  ChannelMenu,
  CouponAsset,
  Nutrition,
  PriceQuote,
  PriceRequest,
  TraceEntry,
} from '@/lib/types';

export type PriceOutcome =
  | { ok: true; quote: PriceQuote }
  | { ok: false; code?: number; message: string };

/**
 * 数据网关：把「真实 MCP」与「离线 fixtures」抽象成同一接口。
 * 优化器只依赖该接口，因此 mock 模式与 live 模式走的是完全相同的决策代码。
 */
export interface McdGateway {
  readonly mode: 'mock' | 'live';
  readonly priceCallBudget: number;
  /** 已消耗的核价调用次数（可观测指标） */
  readonly priceCalls: number;
  channels(storeCode: string, addressId?: string): Promise<ChannelAvailability[]>;
  menus(storeCode: string, channels: ChannelId[]): Promise<ChannelMenu[]>;
  tryPrice(req: PriceRequest): Promise<PriceOutcome>;
  coupons(): Promise<CouponAsset[]>;
  nutrition(): Promise<Nutrition[]>;
  trace(): TraceEntry[];
}
