import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import type { ChannelId, Intent } from '@/lib/types';
import { createGateway } from '@/domain/factory';
import { optimize } from '@/domain/optimizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CHANNELS: ChannelId[] = ['dine_in', 'delivery', 'group_meal', 'drive_thru'];

function toCents(yuan: unknown): number | undefined {
  if (yuan == null || yuan === '') return undefined;
  const n = typeof yuan === 'number' ? yuan : Number.parseFloat(String(yuan));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

export async function GET() {
  return NextResponse.json({
    mode: env.mode,
    defaults: {
      storeCode: env.defaultStoreCode,
      hasAddressId: Boolean(env.defaultAddressId),
      priceCallBudget: env.priceCallBudget,
    },
    hint:
      env.mode === 'live'
        ? 'live 模式：直连麦当劳 MCP，凭据仅在服务端使用'
        : 'mock 模式：使用 fixtures/ 中的脱敏真实快照，无需凭据',
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const storeCode = String(body.storeCode ?? env.defaultStoreCode ?? '').trim();
    if (!/^\d{4,12}$/.test(storeCode)) {
      return NextResponse.json({ error: 'storeCode 必须是数字门店编码' }, { status: 400 });
    }

    const rawChannels = Array.isArray(body.channelPreference) ? (body.channelPreference as string[]) : [];
    const channelPreference = rawChannels.filter((c): c is ChannelId => VALID_CHANNELS.includes(c as ChannelId));

    const budgetCents = toCents(body.budgetYuan);
    const maxKcalRaw = Number(body.maxKcal);
    const maxKcal = Number.isFinite(maxKcalRaw) && maxKcalRaw > 0 ? maxKcalRaw : undefined;
    const mustContain = Array.isArray(body.mustContain)
      ? (body.mustContain as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : ['汉堡'];

    const intent: Intent = {
      storeCode,
      addressId: typeof body.addressId === 'string' && body.addressId ? body.addressId : env.defaultAddressId || undefined,
      budgetCents,
      maxKcal,
      mustContain,
      servings: 1,
      channelPreference,
      preferCoupon: body.preferCoupon !== false,
    };

    const gateway = createGateway(storeCode, intent.addressId);
    const result = await optimize(gateway, intent);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
