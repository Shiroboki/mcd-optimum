import { describe, expect, it } from 'vitest';
import type { ChannelMenu, ProductEntity } from '@/lib/types';
import { buildAlignedIndex, crossChannelSpread, matchNutrition, normalizeName } from '@/domain/catalog';

function product(channel: ProductEntity['channel'], productCode: string, name: string, priceCents: number): ProductEntity {
  return { channel, productCode, name, priceCents, originalPriceCents: priceCents, category: '其他', tags: [] };
}

describe('catalog: 跨渠道商品实体对齐', () => {
  it('归一化能抹平渠道间的命名差异', () => {
    expect(normalizeName('可口可乐')).toBe(normalizeName('可乐'));
    expect(normalizeName('龙焰鸡腿堡单人餐（麦金卡免配）')).toBe('龙焰鸡腿堡单人餐');
    expect(normalizeName('纯牛奶(盒装)')).toBe('纯牛奶');
  });

  it('同名商品在两个渠道被对齐成同一个实体', () => {
    const menus: ChannelMenu[] = [
      {
        channel: 'dine_in',
        storeCode: '3230323',
        products: [product('dine_in', '1100', '巨无霸', 2650), product('dine_in', '9900008751', '可乐', 950)],
      },
      {
        channel: 'delivery',
        storeCode: '3230323',
        products: [product('delivery', '901100', '巨无霸', 2900), product('delivery', '903050', '可口可乐', 1100)],
      },
    ];
    const aligned = buildAlignedIndex(menus);
    const bigMac = aligned.find((p) => p.name === '巨无霸');
    expect(bigMac?.byChannel.dine_in?.productCode).toBe('1100');
    expect(bigMac?.byChannel.delivery?.productCode).toBe('901100');

    const cola = aligned.find((p) => p.key === normalizeName('可乐'));
    expect(cola?.byChannel.delivery?.priceCents).toBe(1100);

    const spread = crossChannelSpread(bigMac!);
    expect(spread.deltaCents).toBe(250);
    expect(spread.minChannel).toBe('dine_in');
  });
});

describe('catalog: 营养表模糊匹配', () => {
  const nutrition = [
    { name: '中薯条', energyKcal: 289, protein: 4, fat: 12, carbohydrate: 38, sodium: 165 },
    { name: '巨无霸', energyKcal: 513, protein: 27, fat: 26, carbohydrate: 42, sodium: 961 },
    { name: '可乐中杯', energyKcal: 147, protein: 0, fat: 0, carbohydrate: 36, sodium: 0 },
  ];

  it('菜单名与营养表名不一致时仍能命中', () => {
    expect(matchNutrition(nutrition, '薯条')?.energyKcal).toBe(289);
    expect(matchNutrition(nutrition, '巨无霸')?.energyKcal).toBe(513);
    expect(matchNutrition(nutrition, '可乐')?.energyKcal).toBe(147);
  });

  it('匹配不到时返回 undefined 而不是乱配', () => {
    expect(matchNutrition(nutrition, '完全不存在的东西')).toBeUndefined();
  });
});
