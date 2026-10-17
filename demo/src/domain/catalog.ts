import type { AlignedProduct, ChannelId, ChannelMenu, Nutrition, ProductEntity } from '@/lib/types';
import { yuanToCents } from '@/lib/units';

/**
 * 商品实体对齐。
 * 实测结论（见 docs/SMOKE_TEST_REPORT.md §3）：同一商品在不同渠道 productCode 完全不同，
 * 所以跨渠道比价必须先按「名称归一化」把商品对齐，不能按 code 匹配。
 */

const PAREN = /[（(][^）)]*[）)]/g;

const SYNONYMS: Array<[RegExp, string]> = [
  [/^可口可乐/, '可乐'],
  [/^雪碧麦炫酷/, '雪碧'],
  [/汉堡包$/u, '汉堡'],
  [/^经典麦旋风$/, '麦旋风'],
  [/^奥利奥麦旋风$/, '麦旋风'],
];

export function normalizeName(raw: string): string {
  let s = raw.normalize('NFKC').replace(PAREN, '').replace(/\s+/gu, '');
  for (const [re, replacement] of SYNONYMS) s = s.replace(re, replacement);
  return s;
}

/** 从 query-meals 的原始响应里解析出统一商品实体（兼容 data.meals 映射表结构）。 */
export function parseMenuPayload(
  payload: unknown,
  channel: ChannelId,
  storeCode: string,
): ProductEntity[] {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return [];

  const categoryOf = new Map<string, string>();
  const categories = (data.categories as Array<{ name: string; meals?: Array<{ code: string }> }>) ?? [];
  for (const category of categories) {
    for (const meal of category.meals ?? []) categoryOf.set(meal.code, category.name);
  }

  const meals = (data.meals as Record<string, Record<string, unknown>>) ?? {};
  const products: ProductEntity[] = [];
  for (const [productCode, meal] of Object.entries(meals)) {
    const name = typeof meal.name === 'string' ? meal.name : '';
    if (!name) continue;
    const priceCents = yuanToCents(String(meal.currentPrice ?? meal.originalPrice ?? '0'));
    const originalPriceCents = yuanToCents(String(meal.originalPrice ?? meal.currentPrice ?? '0'));
    products.push({
      channel,
      productCode,
      name,
      priceCents,
      originalPriceCents,
      category: categoryOf.get(productCode) ?? '未分类',
      tags: [],
      discountType: typeof meal.discountType === 'string' ? meal.discountType : undefined,
      canWithOrder: Boolean(meal.canWithOrder),
    });
  }
  return products;
}

/** 把「分类 + 标签」补回商品实体（query-meals 的 categories 里带 tags）。 */
export function attachTags(payload: unknown, products: ProductEntity[]): ProductEntity[] {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  const categories = (data?.categories as Array<{ name: string; meals?: Array<{ code: string; tags?: string[] }> }>) ?? [];
  const tagsOf = new Map<string, string[]>();
  for (const category of categories) {
    for (const meal of category.meals ?? []) {
      if (meal.tags?.length) tagsOf.set(meal.code, meal.tags);
    }
  }
  for (const product of products) product.tags = tagsOf.get(product.productCode) ?? [];
  return products;
}

export function buildAlignedIndex(menus: ChannelMenu[]): AlignedProduct[] {
  const index = new Map<string, AlignedProduct>();
  for (const menu of menus) {
    for (const product of menu.products) {
      const key = normalizeName(product.name);
      const existing = index.get(key);
      if (existing) {
        existing.byChannel[menu.channel] = product;
      } else {
        index.set(key, { key, name: product.name, byChannel: { [menu.channel]: product } });
      }
    }
  }
  return [...index.values()];
}

/** 同款商品在各渠道的价差信息（用于「为什么要选这个渠道」的解释链）。 */
export function crossChannelSpread(aligned: AlignedProduct): {
  min: number;
  max: number;
  minChannel?: ChannelId;
  maxChannel?: ChannelId;
  deltaCents: number;
} {
  const entries = Object.entries(aligned.byChannel) as Array<[ChannelId, ProductEntity]>;
  if (entries.length === 0) return { min: 0, max: 0, deltaCents: 0 };
  let minEntry = entries[0];
  let maxEntry = entries[0];
  for (const entry of entries) {
    if (entry[1].priceCents < minEntry[1].priceCents) minEntry = entry;
    if (entry[1].priceCents > maxEntry[1].priceCents) maxEntry = entry;
  }
  return {
    min: minEntry[1].priceCents,
    max: maxEntry[1].priceCents,
    minChannel: minEntry[0],
    maxChannel: maxEntry[0],
    deltaCents: maxEntry[1].priceCents - minEntry[1].priceCents,
  };
}

const NUTRITION_STRIP = /^(中杯|大杯|小杯|迷你|经典|双层|大|中|小)/u;
const NUTRITION_TAIL = /(中杯|大杯|小杯)$/u;

/** 营养表品名与菜单名不完全一致（"中薯条" vs "薯条"），做多级模糊匹配。 */
export function matchNutrition(nutrition: Nutrition[], menuName: string): Nutrition | undefined {
  const target = normalizeName(menuName);
  const exact = nutrition.find((n) => normalizeName(n.name) === target);
  if (exact) return exact;

  const strip = (s: string) => normalizeName(s).replace(NUTRITION_STRIP, '').replace(NUTRITION_TAIL, '');
  const targetStripped = strip(target);
  const stripped = nutrition.find((n) => strip(n.name) === targetStripped);
  if (stripped) return stripped;

  // 包含匹配：取最短候选，避免 "可乐" 命中 "无糖可乐" 这类误配
  const candidates = nutrition.filter((n) => {
    const a = strip(n.name);
    return a.length >= 2 && (a.includes(targetStripped) || targetStripped.includes(a));
  });
  candidates.sort((a, b) => a.name.length - b.name.length);
  return candidates[0];
}
