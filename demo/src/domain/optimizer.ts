import type {
  AlignedProduct,
  ChannelAvailability,
  ChannelId,
  ChannelMenu,
  CouponAsset,
  CouponProbe,
  Intent,
  OptimizationResult,
  Plan,
  PlanItem,
  PriceQuote,
  ProductEntity,
} from '@/lib/types';
import type { McdGateway } from '@/domain/gateway';
import { buildAlignedIndex, crossChannelSpread, matchNutrition, normalizeName } from '@/domain/catalog';
import { CHANNEL_META, CHANNEL_ORDER } from '@/domain/channels-meta';

/**
 * 优化器：目标函数明确、约束可验证、解释链可回放。
 *
 * 目标：在满足「预算 / 热量 / 必含商品」等硬约束下，找到**总实付最低**的方案，
 *      并同时求解「渠道 × 组合 × 券」三层，而不是只推荐菜品。
 *
 * 关键设计：所有价格都由 calculate-price 复核，模型只做候选生成与剪枝，
 *          因此不会出现「模型自己编价格」——这是本项目和纯 Prompt 推荐的根本区别。
 */

const BURGER_RE = /汉堡|堡|巨无霸|麦香鱼|麦香鸡/u;
const MEAL_RE = /套餐|三件套|四件套|双人餐|单人餐|随心配|随心选|桶|分享餐/u;
const DRINK_RE = /可乐|雪碧|咖啡|美式|红茶|果汁|牛奶|豆浆|纯悦|麦炫酷|冰咖|柠檬|橙|奶铁/u;
const SIDE_RE = /薯条|麦乐鸡|鸡翅|鸡块|派|玉米|冰淇淋|圆筒|麦旋风|薯饼|新地|鸡排/u;

const MAX_CANDIDATES_PER_CHANNEL = 6;
const MAX_COUPON_TRIALS = 6;

interface Candidate {
  channel: ChannelId;
  products: ProductEntity[];
  heuristicCents: number;
  kcal?: number;
}

function kcalOf(nutrition: Awaited<ReturnType<McdGateway['nutrition']>>, product: ProductEntity): number | undefined {
  return matchNutrition(nutrition, product.name)?.energyKcal;
}

function sumKcal(nutrition: Awaited<ReturnType<McdGateway['nutrition']>>, products: ProductEntity[]): number | undefined {
  let total = 0;
  let hit = false;
  for (const p of products) {
    const kcal = kcalOf(nutrition, p);
    if (kcal != null) {
      total += kcal;
      hit = true;
    }
  }
  return hit ? total : undefined;
}

function channelProducts(menu: ChannelMenu): ProductEntity[] {
  return menu.products;
}

function cheapestWithin(products: ProductEntity[], re: RegExp, used: Set<string>): ProductEntity | undefined {
  return products
    .filter((p) => re.test(p.name) && !used.has(p.productCode))
    .sort((a, b) => a.priceCents - b.priceCents)[0];
}

/** 候选生成：套餐 / 主食+饮品 / 主食+小食 / 单主食，均受硬约束过滤。 */
function generateCandidates(
  menus: ChannelMenu[],
  nutrition: Awaited<ReturnType<McdGateway['nutrition']>>,
  intent: Intent,
): Candidate[] {
  const out: Candidate[] = [];
  const mustContain = (intent.mustContain ?? []).filter(Boolean);

  for (const menu of menus) {
    const products = channelProducts(menu);
    if (products.length === 0) continue;

    const seen = new Set<string>();
    const push = (items: ProductEntity[]) => {
      if (items.length === 0) return;
      const key = items.map((i) => i.productCode).join('+');
      if (seen.has(key)) return;
      seen.add(key);

      const joined = normalizeName(items.map((i) => i.name).join(''));
      if (mustContain.some((kw) => !joined.includes(normalizeName(kw)))) return;

      const heuristicCents = items.reduce((sum, i) => sum + i.priceCents, 0);
      if (intent.budgetCents && heuristicCents > intent.budgetCents) return;

      const kcal = sumKcal(nutrition, items);
      if (intent.maxKcal && kcal != null && kcal > intent.maxKcal) return;

      out.push({ channel: menu.channel, products: items, heuristicCents, kcal });
    };

    // 1) 现成套餐（通常比单点便宜，优先级最高）
    for (const product of products.filter((p) => MEAL_RE.test(p.name)).slice(0, 12)) {
      push([product]);
    }

    // 2) 单主食 / 主食 + 饮品 / 主食 + 小食
    const mains = products.filter((p) => BURGER_RE.test(p.name) && !MEAL_RE.test(p.name)).slice(0, 8);
    const drink = cheapestWithin(products, DRINK_RE, new Set());
    const side = cheapestWithin(products, SIDE_RE, new Set());
    for (const main of mains) {
      push([main]);
      if (drink) push([main, drink]);
      if (side) push([main, side]);
    }
  }

  // 每个渠道按启发式价格升序，留少量候选给核价 oracle 复核
  const byChannel = new Map<ChannelId, Candidate[]>();
  for (const candidate of out) {
    const list = byChannel.get(candidate.channel) ?? [];
    list.push(candidate);
    byChannel.set(candidate.channel, list);
  }
  const pruned: Candidate[] = [];
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.heuristicCents - b.heuristicCents);
    pruned.push(...list.slice(0, MAX_CANDIDATES_PER_CHANNEL));
  }
  return pruned;
}

function couponMatchesChannel(coupon: CouponAsset, channel: ChannelId): boolean {
  const keyword = CHANNEL_META[channel].couponTagKeyword;
  return coupon.channelTags.some((tag) => tag.includes(keyword));
}

function couponNotExpired(coupon: CouponAsset, now: Date): boolean {
  if (!coupon.validTo) return true;
  const end = Date.parse(coupon.validTo.replace(/-/g, '/'));
  if (Number.isNaN(end)) return true;
  return end >= now.getTime();
}

function toPlanItems(quote: PriceQuote, products: ProductEntity[], nutrition: Awaited<ReturnType<McdGateway['nutrition']>>): PlanItem[] {
  return quote.lines.map((line) => {
    const product = products.find((p) => p.productCode === line.productCode);
    return {
      productCode: line.productCode,
      name: line.productName,
      quantity: line.quantity,
      priceCents: line.subtotalCents,
      kcal: product ? kcalOf(nutrition, product) : undefined,
    };
  });
}

export async function optimize(gw: McdGateway, intent: Intent): Promise<OptimizationResult> {
  const startedAt = Date.now();
  const diagnostics: string[] = [];
  const couponProbes: CouponProbe[] = [];

  // ---- 1. 渠道探测（含 DT 降级）----
  const availability = await gw.channels(intent.storeCode, intent.addressId);
  const usable = availability.filter((a) => a.available);
  for (const channel of availability) {
    if (!channel.available) {
      const meta = CHANNEL_META[channel.channel];
      diagnostics.push(
        `${meta.label}不可用（${channel.failureCode ?? '无业务码'} ${channel.failureMessage ?? ''}），已自动降级为该渠道不参与比价`,
      );
    }
  }
  if (usable.length === 0) {
    return {
      mode: gw.mode,
      intent,
      plans: [],
      couponProbes,
      diagnostics: [...diagnostics, '没有任何可用渠道，无法生成方案'],
      trace: gw.trace(),
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 渠道偏好排序：偏好渠道优先，但**不牺牲价格**，只作为同价时的 tie-break
  const preference = intent.channelPreference ?? [];
  const availableChannels = usable
    .map((a) => a.channel)
    .sort((a, b) => {
      const ai = preference.indexOf(a);
      const bi = preference.indexOf(b);
      if (ai === -1 && bi === -1) return CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  // ---- 2. 菜单 + 商品对齐 + 营养 ----
  const menus = await gw.menus(intent.storeCode, availableChannels);
  const aligned = buildAlignedIndex(menus);
  const nutrition = await gw.nutrition();
  if (nutrition.length === 0) diagnostics.push('营养数据为空，热量约束降级为「不参与筛选」');

  // ---- 3. 候选生成与 oracle 复核 ----
  const candidates = generateCandidates(menus, nutrition, intent);
  if (candidates.length === 0) diagnostics.push('候选组合为空：可能是预算/热量/必含商品约束过紧');

  const availabilityByChannel = new Map(availability.map((a) => [a.channel, a]));
  const verified: Array<{ candidate: Candidate; quote: PriceQuote }> = [];
  for (const candidate of candidates) {
    const avail = availabilityByChannel.get(candidate.channel);
    const outcome = await gw.tryPrice({
      storeCode: intent.storeCode,
      channel: candidate.channel,
      beCode: avail?.beCode ?? null,
      items: candidate.products.map((p) => ({ productCode: p.productCode, quantity: 1 })),
    });
    if (outcome.ok) {
      verified.push({ candidate, quote: outcome.quote });
    } else {
      diagnostics.push(
        `核价被拒（${CHANNEL_META[candidate.channel].label} ${candidate.products.map((p) => p.name).join('+')}）：${outcome.code ?? ''} ${outcome.message}`,
      );
    }
  }
  if (gw.priceCalls >= gw.priceCallBudget) diagnostics.push(`核价调用已达上限 ${gw.priceCallBudget} 次，护栏生效`);

  // ---- 4. 券层：仅在真实可用时才计入优惠 ----
  const coupons = await gw.coupons();
  if (coupons.length === 0) {
    diagnostics.push('券包为空或无法结构化读取，本次方案不含券优惠（不影响比价结论）');
  } else {
    const now = new Date();
    for (const coupon of coupons) {
      if (!couponNotExpired(coupon, now)) {
        couponProbes.push({ coupon, usable: false, reason: '已过期' });
        continue;
      }
      // 只对「最便宜的若干方案」做试算，控制核价调用成本
      const ranked = [...verified].sort((a, b) => a.quote.totalCents - b.quote.totalCents).slice(0, 3);
      let probed = false;
      for (const entry of ranked) {
        if (couponProbes.filter((p) => p.coupon.title === coupon.title).length > 0) break;
        if (!couponMatchesChannel(coupon, entry.candidate.channel)) continue;
        if (couponProbes.length >= MAX_COUPON_TRIALS) break;

        const avail = availabilityByChannel.get(entry.candidate.channel);
        const outcome = await gw.tryPrice({
          storeCode: intent.storeCode,
          channel: entry.candidate.channel,
          beCode: avail?.beCode ?? null,
          items: entry.candidate.products.map((p) => ({
            productCode: p.productCode,
            quantity: 1,
            couponId: coupon.couponId,
            couponCode: coupon.couponCode,
          })),
        });
        probed = true;
        if (outcome.ok) {
          couponProbes.push({
            coupon,
            usable: true,
            totalCents: outcome.quote.totalCents,
            savingsCents: Math.max(0, entry.quote.totalCents - outcome.quote.totalCents),
          });
          entry.quote = outcome.quote;
          break;
        }
        couponProbes.push({
          coupon,
          usable: false,
          code: outcome.code,
          reason: `${outcome.message}${outcome.code ? ` (${outcome.code})` : ''}`,
        });
        break;
      }
      if (!probed && couponProbes.every((p) => p.coupon.title !== coupon.title)) {
        couponProbes.push({ coupon, usable: false, reason: '适用渠道与候选方案不匹配' });
      }
    }

    if (couponProbes.some((p) => !p.usable)) {
      diagnostics.push(
        `券核销试算：${couponProbes.filter((p) => p.usable).length}/${couponProbes.length} 张可用 —— 「领到券 ≠ 能用券」，本项目把该判定前置到下单之前`,
      );
    }
  }

  // ---- 5. 排序、跨渠道省额、解释链 ----
  const allTotals = new Map<string, PriceQuote[]>();
  for (const entry of verified) {
    const key = entry.candidate.products
      .map((p) => normalizeName(p.name))
      .sort()
      .join('|');
    const list = allTotals.get(key) ?? [];
    list.push(entry.quote);
    allTotals.set(key, list);
  }

  const plans: Plan[] = verified.map((entry, idx) => {
    const meta = CHANNEL_META[entry.candidate.channel];
    const avail = availabilityByChannel.get(entry.candidate.channel);
    const key = entry.candidate.products
      .map((p) => normalizeName(p.name))
      .sort()
      .join('|');
    const peers = allTotals.get(key) ?? [];
    const maxPeer = peers.reduce((max, q) => Math.max(max, q.totalCents), 0);
    const savings = maxPeer > entry.quote.totalCents ? maxPeer - entry.quote.totalCents : 0;

    const explanation: string[] = [];
    explanation.push(
      `${meta.label}实付 ${(entry.quote.totalCents / 100).toFixed(2)} 元（商品 ${(entry.quote.productCents / 100).toFixed(2)} + 配送 ${(entry.quote.deliveryCents / 100).toFixed(2)} + 打包 ${(entry.quote.packingCents / 100).toFixed(2)}${entry.quote.discountCents ? ` − 优惠 ${(entry.quote.discountCents / 100).toFixed(2)}` : ''}）`,
    );
    if (savings > 0) {
      explanation.push(`同款组合在其它渠道最高需 ${(maxPeer / 100).toFixed(2)} 元，本方案省 ${(savings / 100).toFixed(2)} 元`);
    }
    if (entry.candidate.kcal != null) explanation.push(`组合热量约 ${entry.candidate.kcal} kcal`);
    const usedCoupon = couponProbes.find((p) => p.usable && p.totalCents === entry.quote.totalCents);
    if (usedCoupon) explanation.push(`已核销可用券「${usedCoupon.coupon.title}」，省 ${((usedCoupon.savingsCents ?? 0) / 100).toFixed(2)} 元`);
    if (avail?.timeWindows?.length) explanation.push(`该渠道当前时段：${avail.timeWindows.join(' / ')}`);

    const takeWayCode =
      entry.quote.takeWayList?.find((t) => t.code === 'take-in-store')?.code ??
      entry.quote.takeWayList?.[0]?.code;

    return {
      id: `${entry.candidate.channel}-${idx}`,
      channel: entry.candidate.channel,
      channelLabel: meta.label,
      storeCode: intent.storeCode,
      beCode: avail?.beCode ?? null,
      items: toPlanItems(entry.quote, entry.candidate.products, nutrition),
      quote: entry.quote,
      coupon: usedCoupon,
      totalKcal: entry.candidate.kcal,
      savingsVsChannelCents: savings,
      // 分数越低越好：实付 - 省额权重（省额已在解释链中体现，这里只做稳定排序）
      score: entry.quote.totalCents - Math.round(savings * 0.1),
      explanation,
      orderDraft: {
        storeCode: intent.storeCode,
        orderType: meta.orderType,
        beType: meta.beType,
        beCode: avail?.beCode ?? null,
        takeWayCode,
        addressId: intent.addressId,
        items: entry.candidate.products.map((p) => ({
          productCode: p.productCode,
          quantity: 1,
          ...(usedCoupon ? { couponId: usedCoupon.coupon.couponId, couponCode: usedCoupon.coupon.couponCode } : {}),
        })),
      },
    };
  });

  plans.sort((a, b) => a.score - b.score || a.quote.totalCents - b.quote.totalCents);

  // 跨渠道对齐统计（写进 diagnostics，demo 里能直接看到方法论价值）
  const mismatched = aligned.filter((p: AlignedProduct) => Object.keys(p.byChannel).length > 1);
  const spreads = mismatched
    .map((p) => ({ name: p.name, spread: crossChannelSpread(p) }))
    .filter((s) => s.spread.deltaCents > 0)
    .sort((a, b) => b.spread.deltaCents - a.spread.deltaCents)
    .slice(0, 3);
  for (const item of spreads) {
    diagnostics.push(
      `同款价差：${item.name} 在 ${CHANNEL_META[item.spread.minChannel ?? 'dine_in'].label} ${(item.spread.min / 100).toFixed(2)} 元 vs ${CHANNEL_META[item.spread.maxChannel ?? 'delivery'].label} ${(item.spread.max / 100).toFixed(2)} 元，差 ${(item.spread.deltaCents / 100).toFixed(2)} 元`,
    );
  }

  return {
    mode: gw.mode,
    intent,
    plans: plans.slice(0, 6),
    couponProbes,
    diagnostics,
    trace: gw.trace(),
    elapsedMs: Date.now() - startedAt,
  };
}
