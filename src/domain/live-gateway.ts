import { env } from '@/lib/env';
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
import type { McdGateway, PriceOutcome } from '@/domain/gateway';
import { attachTags, parseMenuPayload } from '@/domain/catalog';
import { CHANNEL_META, CHANNEL_ORDER } from '@/domain/channels-meta';
import { McdMcpClient } from '@/mcp/client';

/**
 * live 网关：直连麦当劳官方 MCP（streamable-http）。
 * 业务失败（600012 券不可用 / 60006 商品不可售 / 600047 无门店）一律作为**分支**处理，不抛异常。
 */
export class LiveGateway implements McdGateway {
  readonly mode = 'live' as const;
  readonly priceCallBudget: number;
  private priceCallsUsed = 0;
  readonly client: McdMcpClient;

  constructor(
    private readonly storeCode: string,
    private readonly addressId?: string,
    budget: number = env.priceCallBudget,
    client?: McdMcpClient,
  ) {
    this.priceCallBudget = budget;
    this.client = client ?? McdMcpClient.fromEnv();
  }

  get priceCalls(): number {
    return this.priceCallsUsed;
  }

  trace(): TraceEntry[] {
    return this.client.recorder.list();
  }

  private call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    return this.client.callTool<T>(tool, args);
  }

  async channels(storeCode: string): Promise<ChannelAvailability[]> {
    const out: ChannelAvailability[] = [];

    // 到店自取：优先用收藏门店，失败则视为不可用（真实场景需城市+关键词）
    try {
      const nearby = await this.call<{ success: boolean; code: number; message: string; data?: Array<Record<string, unknown>> }>(
        'query-nearby-stores',
        { beType: 1, searchType: 1 },
      );
      const hit = (nearby.data ?? []).find((s) => String(s.storeCode) === storeCode);
      out.push(
        hit
          ? { channel: 'dine_in', available: true, storeCode, storeName: String(hit.storeName ?? '') }
          : { channel: 'dine_in', available: false, storeCode, failureCode: nearby.code, failureMessage: '收藏门店中未找到该门店' },
      );
    } catch (err) {
      out.push({ channel: 'dine_in', available: false, storeCode, failureMessage: String(err) });
    }

    // 麦乐送 / 团餐：同一接口不同 beType，返回的 beCode 不同
    for (const channel of ['delivery', 'group_meal'] as const) {
      if (!this.addressId) {
        out.push({ channel, available: false, storeCode, failureMessage: '缺少配送地址 ID，无法查询外送渠道' });
        continue;
      }
      try {
        const res = await this.call<{ success: boolean; code: number; message: string; data?: Array<Record<string, unknown>> }>(
          'delivery-query-stores',
          { beType: CHANNEL_META[channel].beType, addressId: this.addressId },
        );
        const hit = (res.data ?? []).find((s) => String(s.storeCode) === storeCode);
        out.push(
          hit
            ? {
                channel,
                available: true,
                storeCode,
                storeName: String(hit.storeName ?? ''),
                beCode: hit.beCode ? String(hit.beCode) : null,
                businessHours: {
                  start: String(hit.businessStartTime ?? ''),
                  end: String(hit.businessEndTime ?? ''),
                },
                timeWindows: Array.isArray(hit.reservationTimeOptions)
                  ? (hit.reservationTimeOptions as Array<Record<string, unknown>>)
                      .map((o) => String(o.reservationOptionText ?? ''))
                      .filter(Boolean)
                      .slice(0, 2)
                  : undefined,
              }
            : { channel, available: false, storeCode, failureCode: res.code, failureMessage: res.message },
        );
      } catch (err) {
        out.push({ channel, available: false, storeCode, failureMessage: String(err) });
      }
    }

    // 得来速：无收藏/无城市定位时必然失败，降级处理（实测 600050 / 600047）
    try {
      const dt = await this.call<{ success: boolean; code: number; message: string; data?: Array<Record<string, unknown>> }>(
        'query-nearby-stores',
        { beType: 5, searchType: 1 },
      );
      const hit = (dt.data ?? []).find((s) => String(s.storeCode) === storeCode);
      out.push(
        hit
          ? {
              channel: 'drive_thru',
              available: true,
              storeCode,
              beCode: hit.beCode ? String(hit.beCode) : null,
              storeName: String(hit.storeName ?? ''),
            }
          : { channel: 'drive_thru', available: false, storeCode, failureCode: dt.code, failureMessage: dt.message || '该账号无得来速门店数据' },
      );
    } catch (err) {
      out.push({ channel: 'drive_thru', available: false, storeCode, failureMessage: String(err) });
    }

    return CHANNEL_ORDER.map((id) => out.find((c) => c.channel === id)).filter((c): c is ChannelAvailability => Boolean(c));
  }

  async menus(storeCode: string, channels: ChannelId[]): Promise<ChannelMenu[]> {
    const availability = await this.channels(storeCode);
    const menus: ChannelMenu[] = [];
    for (const channel of channels) {
      const meta = CHANNEL_META[channel];
      const avail = availability.find((a) => a.channel === channel);
      try {
        const payload = await this.call<unknown>('query-meals', {
          storeCode,
          orderType: meta.orderType,
          beType: meta.beType,
          ...(meta.requiresBeCode && avail?.beCode ? { beCode: avail.beCode } : {}),
        });
        const products = attachTags(payload, parseMenuPayload(payload, channel, storeCode));
        menus.push({ channel, storeCode, products });
      } catch {
        menus.push({ channel, storeCode, products: [] });
      }
    }
    return menus;
  }

  async tryPrice(req: PriceRequest): Promise<PriceOutcome> {
    if (this.priceCallsUsed >= this.priceCallBudget) {
      return { ok: false, message: `核价调用预算用尽（${this.priceCallBudget} 次），已触发护栏` };
    }
    this.priceCallsUsed += 1;

    const meta = CHANNEL_META[req.channel];
    const args: Record<string, unknown> = {
      storeCode: req.storeCode,
      orderType: meta.orderType,
      beType: meta.beType,
      items: req.items,
    };
    if (meta.requiresBeCode && req.beCode) args.beCode = req.beCode;
    if (req.reservationDate) args.reservationDate = req.reservationDate;
    if (typeof req.needTableware === 'boolean') args.needTableware = req.needTableware;

    try {
      const payload = await this.call<{ success?: boolean; code?: number; message?: string; data?: Record<string, unknown> }>(
        'calculate-price',
        args,
      );
      if (payload?.success === false) {
        return { ok: false, code: payload.code, message: payload.message ?? '核价失败' };
      }
      const data = payload?.data;
      if (!data) return { ok: false, message: '核价返回缺少 data 字段' };

      const quote: PriceQuote = {
        channel: req.channel,
        productCents: Number(data.productPrice ?? 0),
        deliveryCents: Number(data.deliveryPrice ?? 0),
        packingCents: Number(data.packingPrice ?? 0),
        totalCents: Number(data.price ?? 0),
        discountCents: Number(data.discount ?? 0),
        lines: ((data.productList as Array<Record<string, unknown>>) ?? [])
          .filter((l) => String(l.productCode) !== '920174') // 剔除打包服务费行，避免重复计费
          .map((l) => ({
            productCode: String(l.productCode ?? ''),
            productName: String(l.productName ?? ''),
            quantity: Number(l.quantity ?? 0),
            originalSubtotalCents: Number(l.originalSubtotal ?? 0),
            subtotalCents: Number(l.subtotal ?? 0),
          })),
        takeWayList: Array.isArray(data.takeWayList)
          ? (data.takeWayList as Array<Record<string, unknown>>).map((t) => ({
              code: String(t.code ?? ''),
              title: String(t.title ?? ''),
            }))
          : undefined,
      };
      return { ok: true, quote };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async coupons(): Promise<CouponAsset[]> {
    try {
      const payload = await this.call<unknown>('query-my-coupons', {});
      const data = (payload as { data?: { coupons?: unknown[] } } | null)?.data;
      const list = Array.isArray(data?.coupons) ? (data?.coupons as Array<Record<string, unknown>>) : [];
      return list.map((c) => ({
        title: String(c.title ?? c.couponName ?? ''),
        couponId: String(c.couponId ?? ''),
        couponCode: String(c.couponCode ?? ''),
        channelTags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        source: 'wallet' as const,
      }));
    } catch {
      return [];
    }
  }

  async nutrition(): Promise<Nutrition[]> {
    try {
      const payload = await this.call<{ data?: unknown }>('list-nutrition-foods', {});
      const raw = payload?.data;
      if (typeof raw !== 'string') return [];
      // 实测返回格式: "[160]{productName,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  名称,null,1288,308,..."
      const rows: Nutrition[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const cells = line.split(',');
        if (cells.length < 5) continue;
        const name = cells[0].trim();
        if (!name || name.startsWith('[') || name.includes('{')) continue;
        const num = (i: number) => Number.parseFloat(cells[i] ?? '0') || 0;
        rows.push({
          name,
          energyKcal: num(3),
          protein: num(4),
          fat: num(5),
          carbohydrate: num(6),
          sodium: num(7),
        });
      }
      return rows;
    } catch {
      return [];
    }
  }
}
