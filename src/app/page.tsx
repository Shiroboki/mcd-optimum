'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OptimizationResult, Plan } from '@/lib/types';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

function PlanCard({ plan, rank }: { plan: Plan; rank: number }) {
  return (
    <article className="card p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-white/50">
            #{rank} · {plan.storeCode}
            {plan.beCode ? ` · beCode ${plan.beCode}` : ''}
          </div>
          <h3 className="mt-1 text-lg font-semibold">
            {plan.channelLabel}
            {rank === 1 ? <span className="ml-2 rounded bg-[var(--brand-yellow)] px-2 py-0.5 text-xs text-black">最省</span> : null}
          </h3>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[var(--brand-yellow)]">{yuan(plan.quote.totalCents)}</div>
          {plan.savingsVsChannelCents ? (
            <div className="text-xs text-emerald-400">跨渠道省 {yuan(plan.savingsVsChannelCents)}</div>
          ) : null}
        </div>
      </header>

      <ul className="mt-3 space-y-1 text-sm text-white/80">
        {plan.items.map((item) => (
          <li key={`${plan.id}-${item.productCode}`} className="flex justify-between gap-2">
            <span>
              {item.name}
              {item.quantity > 1 ? ` ×${item.quantity}` : ''}
              {item.kcal != null ? <span className="ml-2 text-xs text-white/40">{item.kcal} kcal</span> : null}
            </span>
            <span className="mono text-white/60">{yuan(item.priceCents)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {plan.coupon ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-300">🧾 {plan.coupon.coupon.title}</span>
        ) : (
          <span className="rounded-full bg-white/5 px-2 py-1 text-white/40">未使用券</span>
        )}
        {plan.totalKcal != null ? (
          <span className="rounded-full bg-white/5 px-2 py-1 text-white/60">🔥 {plan.totalKcal} kcal</span>
        ) : null}
        <span className="rounded-full bg-white/5 px-2 py-1 text-white/60">
          运费 {yuan(plan.quote.deliveryCents)} · 打包 {yuan(plan.quote.packingCents)}
        </span>
      </div>

      <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs text-white/60">
        {plan.explanation.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
    </article>
  );
}

export default function Home() {
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ mode: string; defaults: { storeCode: string } } | null>(null);
  const [form, setForm] = useState({ budgetYuan: '35', maxKcal: '900', mustContain: '汉堡', storeCode: '' });
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    fetch('/api/optimize')
      .then((r) => r.json())
      .then((data) => {
        setMeta(data);
        setForm((prev) => ({ ...prev, storeCode: prev.storeCode || data.defaults?.storeCode || '' }));
      })
      .catch(() => setError('无法读取服务状态'));
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storeCode: form.storeCode,
          budgetYuan: form.budgetYuan,
          maxKcal: form.maxKcal,
          mustContain: form.mustContain ? form.mustContain.split(/[,，\s]+/u).filter(Boolean) : [],
          channelPreference: ['dine_in', 'delivery', 'group_meal'],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `请求失败 ${res.status}`);
      setResult(data as OptimizationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [form]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            McOptimum <span className="text-[var(--brand-red)]">麦麦最优解</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            在「预算 × 热量 × 必含商品」约束下，同时求解 <b>渠道</b>（到店/麦乐送/团餐）× <b>组合</b>（套餐/换选/特调）×{' '}
            <b>资产</b>（券/积分），所有价格都由麦当劳 MCP 的 <code>calculate-price</code> 真实核价。
          </p>
        </div>
        <div className="text-right text-xs text-white/50">
          <div>
            运行模式：
            <span className={meta?.mode === 'live' ? 'text-emerald-400' : 'text-[var(--brand-yellow)]'}>
              {meta?.mode ?? '...'}
            </span>
          </div>
          {result ? <div>耗时 {result.elapsedMs} ms</div> : null}
        </div>
      </header>

      <section className="card mt-6 p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="text-sm">
            <span className="text-white/50">门店编码</span>
            <input
              className="mono mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              value={form.storeCode}
              onChange={(e) => setForm({ ...form, storeCode: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-white/50">预算（元）</span>
            <input
              className="mono mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              value={form.budgetYuan}
              onChange={(e) => setForm({ ...form, budgetYuan: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-white/50">热量上限（kcal）</span>
            <input
              className="mono mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              value={form.maxKcal}
              onChange={(e) => setForm({ ...form, maxKcal: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-white/50">必含（逗号分隔）</span>
            <input
              className="mono mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              value={form.mustContain}
              onChange={(e) => setForm({ ...form, mustContain: e.target.value })}
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded-lg bg-[var(--brand-red)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? '正在核价…' : '计算最优解'}
          </button>
          <span className="text-xs text-white/40">
            dry-run：只做比价与试算，不会真实下单
          </span>
        </div>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </section>

      {result ? (
        <>
          <section className="mt-6 grid gap-4 lg:grid-cols-3">
            {result.plans.map((plan, index) => (
              <PlanCard key={plan.id} plan={plan} rank={index + 1} />
            ))}
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white/80">券核销判定</h2>
              <p className="mt-1 text-xs text-white/40">领到券 ≠ 能用券：门店 × 渠道 × 商品 × 时段 四维约束</p>
              <ul className="mt-3 space-y-2 text-sm">
                {result.couponProbes.length === 0 ? (
                  <li className="text-white/40">无券可试算</li>
                ) : (
                  result.couponProbes.map((probe) => (
                    <li key={probe.coupon.title} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-white/80">{probe.coupon.title}</div>
                        <div className="text-xs text-white/40">{probe.reason ?? probe.coupon.channelTags.join(' / ')}</div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          probe.usable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {probe.usable ? `可用 省 ${yuan(probe.savingsCents ?? 0)}` : '不可用'}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white/80">诊断与跨渠道价差</h2>
              <ul className="mt-3 space-y-1.5 text-xs text-white/60">
                {result.diagnostics.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card mt-6 p-5">
            <button
              onClick={() => setShowTrace((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-white/80"
            >
              <span>MCP 调用链（已脱敏）· {result.trace.length} 次调用</span>
              <span className="text-white/40">{showTrace ? '收起' : '展开'}</span>
            </button>
            {showTrace ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-white/40">
                    <tr>
                      <th className="py-1 pr-3">tool</th>
                      <th className="py-1 pr-3">ok</th>
                      <th className="py-1 pr-3">code</th>
                      <th className="py-1 pr-3">参数（脱敏）</th>
                      <th className="py-1">耗时</th>
                    </tr>
                  </thead>
                  <tbody className="mono text-white/60">
                    {result.trace.map((entry, index) => (
                      <tr key={`${entry.tool}-${index}`} className="border-t border-white/5">
                        <td className="py-1 pr-3">{entry.tool}</td>
                        <td className="py-1 pr-3">{entry.ok ? '✅' : '❌'}</td>
                        <td className="py-1 pr-3">{entry.code ?? '-'}</td>
                        <td className="max-w-[28rem] truncate py-1 pr-3">{JSON.stringify(entry.args)}</td>
                        <td className="py-1">{entry.latencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <footer className="mt-10 text-center text-xs text-white/30">
        McOptimum · 基于麦当劳官方 MCP 的参赛项目 · 演示为 dry-run，不会产生真实订单
      </footer>
    </main>
  );
}
