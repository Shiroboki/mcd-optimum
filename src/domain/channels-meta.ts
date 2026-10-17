import type { ChannelId } from '@/lib/types';

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  shortLabel: string;
  beType: 1 | 2 | 5 | 6;
  orderType: 1 | 2;
  requiresBeCode: boolean;
  /** 券的「适用渠道标签」与渠道的映射 */
  couponTagKeyword: string;
  feeNote: string;
}

/** 渠道元数据（实测：到店 beType=1 不传 beCode；麦乐送 2、团餐 6、得来速 5 必传 beCode） */
export const CHANNEL_META: Record<ChannelId, ChannelMeta> = {
  dine_in: {
    id: 'dine_in',
    label: '到店自取',
    shortLabel: '自提',
    beType: 1,
    orderType: 1,
    requiresBeCode: false,
    couponTagKeyword: '到店',
    feeNote: '无配送费与打包费',
  },
  delivery: {
    id: 'delivery',
    label: '麦乐送',
    shortLabel: '外送',
    beType: 2,
    orderType: 2,
    requiresBeCode: true,
    couponTagKeyword: '外送',
    feeNote: '含配送费 + 打包费',
  },
  group_meal: {
    id: 'group_meal',
    label: '企业团餐',
    shortLabel: '团餐',
    beType: 6,
    orderType: 2,
    requiresBeCode: true,
    couponTagKeyword: '外送',
    feeNote: '含配送费 + 打包费，需助餐服务编码',
  },
  drive_thru: {
    id: 'drive_thru',
    label: '得来速',
    shortLabel: 'DT',
    beType: 5,
    orderType: 1,
    requiresBeCode: true,
    couponTagKeyword: '到店',
    feeNote: '车道取餐',
  },
};

export const CHANNEL_ORDER: ChannelId[] = ['dine_in', 'delivery', 'group_meal', 'drive_thru'];
