#!/usr/bin/env node
/**
 * mcd-optimize.mjs — 麦当劳跨渠道比价 / 最优组合计算（零依赖）
 *
 * 设计原则：本脚本只做**确定性计算**，不联网、不猜价格。
 * 所有价格必须由 Agent 先通过 MCP 的 calculate-price 拿到后喂进来；
 * 没有核价结果时只输出「预估」并显式标注，绝不当成实付。
 *
 * 用法：
 *   node scripts/mcd-optimize.mjs --align --input payload.json
 *   node scripts/mcd-optimize.mjs --plan  --input payload.json --format md
 *   cat payload.json | node scripts/mcd-optimize.mjs --plan
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CHANNEL_LABEL = {
  dine_in: '到店自取',
  delivery: '麦乐送',
  group_meal: '企业团餐',
  drive_thru: '得来速',
};

/** 估算用费用表（仅在没有核价结果时使用，且输出会标注「预估」） */
const FEE_ESTIMATE = {
  dine_in: { deliveryCents: 0, packingCents: 0 },
  delivery: { deliveryCents: 600, packingCents: 110 },
  group_meal: { deliveryCents: 600, packingCents: 110 },
  drive_thru: { deliveryCents: 0, packingCents: 0 },
};

const PAREN = /[（(][^）)]*[）)]/g;
const SYNONYMS = [
  [/^可口可乐/, '可乐'],
  [/汉堡包$/u, '汉堡'],
  [/^经典麦旋风$/, '麦旋风'],
];

export function normalizeName(raw) {
  let s = String(raw ?? '')
    .normalize('NFKC')
    .replace(PAREN, '')
    .replace(/\s+/gu, '');
  for (const [re, replacement] of SYNONYMS) s = s.replace(re, replacement);
  return s;
}

export function yuanToCents(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const n = Number.parseFloat(String(value ?? '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function formatYuan(cents) {
  return `¥${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
}

/** 跨渠道商品对齐：同款商品在不同渠道 productCode 不同，按名称归一化对齐 */
export function alignProducts(menus) {
  const index = new Map();
  for (const menu of menus ?? []) {
    for (const product of menu.products ?? []) {
      const key = normalizeName(product.name);
      if (!key) continue;
      const entry = index.get(key) ?? { key, name: product.name, byChannel: {} };
      entry.byChannel[menu.channel] = {
        productCode: product.productCode,
        priceCents: Number(product.priceCents) || 0,
        name: product.name,
      };
      index.set(key, entry);
    }
  }
  return [...index.values()];
}

export function crossChannelSpread(entry) {
  const rows = Object.entries(entry.byChannel ?? {});
  if (rows.length === 0) return { deltaCents: 0 };
  let min = rows[0];
  let max = rows[0];
  for (const row of rows) {
    if (row[1].priceCents < min[1].priceCents) min = row;
    if (row[1].priceCents > max[1].priceCents) max = row;
  }
  return {
    min,
    max,
    deltaCents: max[1].priceCents - min[1].priceCents,
    minChannel: min[0],
    maxChannel: max[0],
  };
}

const MEAL_RE = /套餐|三件套|四件套|双人餐|单人餐|随心配|随心选|桶/u;
const BURGER_RE = /汉堡|堡|巨无霸|麦香鱼|麦香鸡/u;
const DRINK_RE = /可乐|雪碧|咖啡|美式|红茶|果汁|牛奶|豆浆|纯悦|麦炫酷|冰咖|柠檬|橙/u;
const SIDE_RE = /薯条|麦乐鸡|鸡翅|鸡块|派|玉米|冰淇淋|圆筒|麦旋风|薯饼|新地|鸡排/u;

function kcalOf(nutrition, name) {
  const list = nutrition ?? [];
  const target = normalizeName(name);
  // 营养表品名与菜单名不一致（"中薯条" vs 菜单"薯条"、"可乐中杯" vs "可乐"），
  // 做三级匹配：精确 → 去规格词 → 包含匹配（取最短候选，避免"可乐"误配"无糖可乐"）
  const strip = (s) =>
    normalizeName(s)
      .replace(/^(中杯|大杯|小杯|迷你|经典|双层|大|中|小)/u, '')
      .replace(/(中杯|大杯|小杯)$/u, '');

  const exact = list.find((n) => normalizeName(n.name) === target);
  if (exact) return exact.energyKcal;

  const stripped = strip(target);
  if (!stripped) return undefined;
  const byStrip = list.find((n) => strip(n.name) === stripped);
  if (byStrip) return byStrip.energyKcal;

  const candidates = list
    .filter((n) => {
      const value = strip(n.name);
      return value.length >= 2 && (value.includes(stripped) || stripped.includes(value));
    })
    .sort((a, b) => a.name.length - b.name.length);
  return candidates[0]?.energyKcal;
}

function sumKcal(nutrition, products) {
  let total = 0;
  let hit = false;
  for (const product of products) {
    const kcal = kcalOf(nutrition, product.name);
    if (kcal != null) {
      total += kcal;
      hit = true;
    }
  }
  return hit ? total : undefined;
}

/** 候选生成 + 硬约束过滤 */
export function generateCandidates({ menus, intent = {}, nutrition = [] }) {
  const mustContain = (intent.mustContain ?? []).filter(Boolean).map(normalizeName);
  const budget = Number(intent.budgetCents) || 0;
  const maxKcal = Number(intent.maxKcal) || 0;
  const candidates = [];

  for (const menu of menus ?? []) {
    const products = menu.products ?? [];
    const seen = new Set();
    const push = (items) => {
      if (items.length === 0) return;
      const key = items.map((p) => p.productCode).join('+');
      if (seen.has(key)) return;
      seen.add(key);

      const joined = normalizeName(items.map((p) => p.name).join(''));
      if (mustContain.some((kw) => !joined.includes(kw))) return;

      const productCents = items.reduce((sum, p) => sum + (Number(p.priceCents) || 0), 0);
      if (budget > 0 && productCents > budget) return;

      const kcal = sumKcal(nutrition, items);
      if (maxKcal > 0 && kcal != null && kcal > maxKcal) return;

      candidates.push({ channel: menu.channel, items, productCents, kcal });
    };

    for (const product of products.filter((p) => MEAL_RE.test(p.name)).slice(0, 12)) push([product]);

    const mains = products.filter((p) => BURGER_RE.test(p.name) && !MEAL_RE.test(p.name)).slice(0, 8);
    const drink = products.filter((p) => DRINK_RE.test(p.name)).sort((a, b) => a.priceCents - b.priceCents)[0];
    const side = products.filter((p) => SIDE_RE.test(p.name)).sort((a, b) => a.priceCents - b.priceCents)[0];
    for (const main of mains) {
      push([main]);
      if (drink && drink.productCode !== main.productCode) push([main, drink]);
      if (side && side.productCode !== main.productCode) push([main, side]);
    }
  }
  return candidates;
}

/**
 * 方案计算：优先用核价结果（quotes），缺失则按费用表预估并标注。
 * quotes: [{ channel, lines?:[{productCode, quantity, subtotalCents}], totalCents, deliveryCents, packingCents, discountCents }]
 */
export function buildPlans({ candidates, quotes = [], coupons = [], channels = [], intent = {} }) {
  const quoteByKey = new Map();
  for (const quote of quotes) {
    const key = `${quote.channel}:${(quote.items ?? []).map((i) => i.productCode).sort().join('+')}`;
    quoteByKey.set(key, quote);
  }
  const available = new Set(
    channels.filter((c) => c.available !== false).map((c) => c.channel ?? c.id),
  );

  const plans = [];
  for (const candidate of candidates) {
    if (available.size > 0 && !available.has(candidate.channel)) continue;
    const itemKey = `${candidate.channel}:${candidate.items.map((i) => i.productCode).sort().join('+')}`;
    const quote = quoteByKey.get(itemKey);
    const fee = FEE_ESTIMATE[candidate.channel] ?? { deliveryCents: 0, packingCents: 0 };

    const verified = Boolean(quote);
    const deliveryCents = verified ? Number(quote.deliveryCents ?? 0) : fee.deliveryCents;
    const packingCents = verified ? Number(quote.packingCents ?? 0) : fee.packingCents;
    const discountCents = verified ? Number(quote.discountCents ?? 0) : 0;
    const totalCents = verified
      ? Number(quote.totalCents ?? 0)
      : candidate.productCents + deliveryCents + packingCents;

    // 券：只接受调用方（Agent 通过 calculate-price 试算后）给出的明确结论
    const coupon = coupons.find(
      (c) => c.usable === true && (c.channelTags ?? []).length > 0 && matchCouponChannel(c, candidate.channel),
    );
    const finalCents = coupon?.totalCents != null ? Number(coupon.totalCents) : totalCents;

    plans.push({
      channel: candidate.channel,
      channelLabel: CHANNEL_LABEL[candidate.channel] ?? candidate.channel,
      items: candidate.items.map((p) => ({
        productCode: p.productCode,
        name: p.name,
        priceCents: Number(p.priceCents) || 0,
        kcal: kcalOf(intent.nutrition ?? [], p.name),
      })),
      productCents: candidate.productCents,
      deliveryCents,
      packingCents,
      discountCents,
      totalCents: finalCents,
      verified,
      coupon: coupon ? { title: coupon.title, savingsCents: coupon.savingsCents ?? 0 } : undefined,
      kcal: candidate.kcal,
    });
  }

  // 同款组合跨渠道省额：按「商品名集合」分组比 max
  const groups = new Map();
  for (const plan of plans) {
    const key = plan.items.map((i) => normalizeName(i.name)).sort().join('|');
    const list = groups.get(key) ?? [];
    list.push(plan);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    const max = Math.max(...list.map((p) => p.totalCents));
    for (const plan of list) plan.savingsVsChannelCents = Math.max(0, max - plan.totalCents);
  }

  plans.sort((a, b) => a.totalCents - b.totalCents || Number(a.verified ? 1 : 0) - Number(b.verified ? 1 : 0));
  return plans;
}

function matchCouponChannel(coupon, channel) {
  const keyword = channel === 'dine_in' || channel === 'drive_thru' ? '到店' : '外送';
  return (coupon.channelTags ?? []).some((tag) => String(tag).includes(keyword));
}

/** 券判定汇总：把 Agent 试算得到的结论整理成可读结论 */
export function summarizeCoupons(coupons = []) {
  return coupons.map((c) => ({
    title: c.title ?? '(未命名券)',
    usable: Boolean(c.usable),
    reason: c.usable ? `可用，省 ${formatYuan(c.savingsCents ?? 0)}` : c.reason ?? '不可用',
    code: c.code,
  }));
}

export function toMarkdown({ intent = {}, plans = [], coupons = [], diagnostics = [] }) {
  const lines = [];
  lines.push('# 麦当劳最优方案（dry-run）');
  lines.push('');
  if (plans.length === 0) {
    lines.push('> 没有满足约束的方案。建议放宽预算/热量，或换一家门店。');
    return lines.join('\n');
  }
  const best = plans[0];
  const delta = best.savingsVsChannelCents ?? 0;
  lines.push(
    `**结论**：最省是【${best.channelLabel}】${formatYuan(best.totalCents)}${
      delta > 0 ? `，比其它渠道同款最多省 ${formatYuan(delta)}` : ''
    }。${plans.every((p) => p.verified) ? '' : '（含未核价项，标注「预估」的方案请补跑 calculate-price）'}`,
  );
  lines.push('');
  lines.push('| # | 渠道 | 组合 | 商品 | 运费 | 打包 | 券 | 实付 | 热量 | 核价 |');
  lines.push('|---|------|------|------|------|------|----|------|------|------|');
  plans.forEach((plan, index) => {
    lines.push(
      `| ${index + 1} | ${plan.channelLabel} | ${plan.items.map((i) => i.name).join(' + ')} | ${formatYuan(
        plan.productCents,
      )} | ${formatYuan(plan.deliveryCents)} | ${formatYuan(plan.packingCents)} | ${
        plan.coupon ? plan.coupon.title : '无'
      } | ${formatYuan(plan.totalCents)} | ${plan.kcal != null ? `${plan.kcal} kcal` : '未知'} | ${
        plan.verified ? '✅ 官方核价' : '⚠️ 预估'
      } |`,
    );
  });
  lines.push('');
  if (coupons.length > 0) {
    lines.push('**券核销判定**（来自 calculate-price 试算，不是「券包显示可用」）：');
    for (const coupon of summarizeCoupons(coupons)) {
      lines.push(`- ${coupon.title} → ${coupon.usable ? '✅' : '❌'} ${coupon.reason}`);
    }
    lines.push('');
  }
  if (diagnostics.length > 0) {
    lines.push('**说明**：');
    for (const line of diagnostics) lines.push(`- ${line}`);
    lines.push('');
  }
  lines.push('> 以上为 dry-run 结果，**未下单**。需要下单请明确确认，并注意到店需 takeWayCode、外送需 beCode。');
  return lines.join('\n');
}

export function runPayload(payload, mode) {
  const menus = payload.menus ?? [];
  const intent = payload.intent ?? {};
  if (mode === 'align') {
    const aligned = alignProducts(menus).map((entry) => {
      const spread = crossChannelSpread(entry);
      return {
        name: entry.name,
        byChannel: entry.byChannel,
        deltaCents: spread.deltaCents,
        cheaperChannel: spread.minChannel,
        cheaperCents: spread.min?.[1]?.priceCents,
        expensiveCents: spread.max?.[1]?.priceCents,
      };
    });
    return { mode, aligned };
  }

  const candidates = generateCandidates({ menus, intent, nutrition: payload.nutrition ?? [] });
  const plans = buildPlans({
    candidates,
    quotes: payload.quotes ?? [],
    coupons: payload.coupons ?? [],
    channels: payload.channels ?? [],
    intent,
  });
  return {
    mode,
    plans,
    coupons: summarizeCoupons(payload.coupons ?? []),
    diagnostics: payload.diagnostics ?? [],
  };
}

function parseArgs(argv) {
  const args = { mode: 'plan', format: 'json', input: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--align') args.mode = 'align';
    else if (arg === '--plan') args.mode = 'plan';
    else if (arg === '--format') args.format = argv[++i];
    else if (arg === '--input') args.input = argv[++i];
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = args.input ? readFileSync(args.input, 'utf8') : await readStdin();
  if (!raw.trim()) {
    console.error('输入为空。用 --input <file> 或通过 stdin 传 JSON。');
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error(`JSON 解析失败：${err.message}`);
    process.exit(1);
  }
  const result = runPayload(payload, args.mode);
  if (args.format === 'md') {
    console.log(
      result.mode === 'align'
        ? toAlignMarkdown(result)
        : toMarkdown({
            intent: payload.intent ?? {},
            plans: result.plans,
            coupons: payload.coupons ?? [],
            diagnostics: result.diagnostics,
          }),
    );
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function toAlignMarkdown({ aligned }) {
  const lines = ['| 商品 | 各渠道价 | 价差 | 最便宜 |', '|---|---|---|---|'];
  for (const entry of aligned) {
    const prices = Object.entries(entry.byChannel)
      .map(([channel, p]) => `${CHANNEL_LABEL[channel] ?? channel} ${formatYuan(p.priceCents)}`)
      .join(' / ');
    lines.push(
      `| ${entry.name} | ${prices} | ${formatYuan(entry.deltaCents)} | ${
        CHANNEL_LABEL[entry.cheaperChannel] ?? entry.cheaperChannel
      } |`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
