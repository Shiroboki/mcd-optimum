import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignProducts,
  buildPlans,
  crossChannelSpread,
  generateCandidates,
  normalizeName,
  summarizeCoupons,
  yuanToCents,
} from './mcd-optimize.mjs';

test('名称归一化抹平跨渠道命名差异', () => {
  assert.equal(normalizeName('可口可乐'), normalizeName('可乐'));
  assert.equal(normalizeName('龙焰鸡腿堡单人餐（麦金卡免配）'), '龙焰鸡腿堡单人餐');
  assert.equal(normalizeName('纯牛奶(盒装)'), '纯牛奶');
});

test('元字符串转分', () => {
  assert.equal(yuanToCents('26.5'), 2650);
  assert.equal(yuanToCents('¥9.9'), 990);
});

test('跨渠道对齐：同款商品不同 productCode 被对齐，并算出价差', () => {
  const aligned = alignProducts([
    { channel: 'dine_in', products: [{ productCode: '1100', name: '巨无霸', priceCents: 2650 }] },
    { channel: 'delivery', products: [{ productCode: '901100', name: '巨无霸', priceCents: 2900 }] },
  ]);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].byChannel.dine_in.productCode, '1100');
  assert.equal(aligned[0].byChannel.delivery.productCode, '901100');
  assert.equal(crossChannelSpread(aligned[0]).deltaCents, 250);
});

test('候选生成遵守预算 / 热量 / 必含约束', () => {
  const menus = [
    {
      channel: 'dine_in',
      products: [
        { productCode: '1440', name: '麦辣鸡腿汉堡', priceCents: 2250 },
        { productCode: '9900008751', name: '可乐', priceCents: 950 },
        { productCode: '9900013304', name: '人气经典随心配', priceCents: 1490 },
      ],
    },
  ];
  const nutrition = [
    { name: '麦辣鸡腿汉堡', energyKcal: 485 },
    { name: '可乐中杯', energyKcal: 147 },
  ];
  const cheap = generateCandidates({ menus, intent: { budgetCents: 2000 }, nutrition });
  assert.ok(cheap.every((c) => c.productCents <= 2000));

  const lowKcal = generateCandidates({ menus, intent: { maxKcal: 200 }, nutrition });
  assert.ok(lowKcal.every((c) => c.kcal == null || c.kcal <= 200));

  const withCola = generateCandidates({ menus, intent: { mustContain: ['汉堡'] }, nutrition });
  assert.ok(withCola.some((c) => c.items.some((i) => i.name.includes('汉堡'))));
});

test('方案排序：实付升序，并给出跨渠道省额', () => {
  const menus = [
    { channel: 'dine_in', products: [{ productCode: '1440', name: '麦辣鸡腿汉堡', priceCents: 2250 }] },
    { channel: 'delivery', products: [{ productCode: '901440', name: '麦辣鸡腿汉堡', priceCents: 2550 }] },
  ];
  const candidates = generateCandidates({ menus, intent: { mustContain: ['汉堡'] } });
  const quotes = [
    {
      channel: 'dine_in',
      items: [{ productCode: '1440', quantity: 1 }],
      totalCents: 2250,
      deliveryCents: 0,
      packingCents: 0,
    },
    {
      channel: 'delivery',
      items: [{ productCode: '901440', quantity: 1 }],
      totalCents: 3260,
      deliveryCents: 600,
      packingCents: 110,
    },
  ];
  const plans = buildPlans({ candidates, quotes, channels: [{ channel: 'dine_in' }, { channel: 'delivery' }] });
  assert.equal(plans[0].channel, 'dine_in');
  assert.equal(plans[0].totalCents, 2250);
  assert.equal(plans[0].savingsVsChannelCents, 1010);
  assert.ok(plans.every((p) => p.verified));
});

test('没有核价结果时标记为预估，而不是伪装成实付', () => {
  const candidates = generateCandidates({
    menus: [{ channel: 'delivery', products: [{ productCode: '901440', name: '麦辣鸡腿汉堡', priceCents: 2550 }] }],
    intent: { mustContain: ['汉堡'] },
  });
  const plans = buildPlans({ candidates, quotes: [], channels: [{ channel: 'delivery' }] });
  assert.equal(plans[0].verified, false);
  assert.equal(plans[0].deliveryCents, 600);
  assert.equal(plans[0].totalCents, 2550 + 600 + 110);
});

test('营养表模糊匹配：可乐 能匹配到 可乐中杯，热量不能少算', () => {
  const menus = [
    {
      channel: 'dine_in',
      products: [
        { productCode: '1440', name: '麦辣鸡腿汉堡', priceCents: 2250 },
        { productCode: '9900008751', name: '可乐', priceCents: 950 },
      ],
    },
  ];
  const nutrition = [
    { name: '麦辣鸡腿汉堡', energyKcal: 485 },
    { name: '可乐中杯', energyKcal: 147 },
  ];
  const candidates = generateCandidates({ menus, intent: { mustContain: ['汉堡'] }, nutrition });
  const combo = candidates.find((c) => c.items.length === 2);
  assert.ok(combo, '应该生成 汉堡+可乐 的组合');
  assert.equal(combo.kcal, 485 + 147);
});

test('热量上限会真的过滤掉超限组合（不能因为匹配失败而漏过）', () => {
  const menus = [
    {
      channel: 'dine_in',
      products: [
        { productCode: '1440', name: '麦辣鸡腿汉堡', priceCents: 2250 },
        { productCode: '9900008751', name: '可乐', priceCents: 950 },
      ],
    },
  ];
  const nutrition = [
    { name: '麦辣鸡腿汉堡', energyKcal: 485 },
    { name: '可乐中杯', energyKcal: 147 },
  ];
  const candidates = generateCandidates({ menus, intent: { maxKcal: 600 }, nutrition });
  assert.ok(candidates.every((c) => c.items.length === 1), '汉堡+可乐 632 kcal 应被 600 上限过滤');
});

test('券结论原样透出，不美化', () => {
  const summary = summarizeCoupons([{ title: 'A券', usable: false, code: 600012, reason: '当前优惠券不可用！(600012)' }]);
  assert.equal(summary[0].usable, false);
  assert.match(summary[0].reason, /600012/);
});
