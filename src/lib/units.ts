/** 金额统一模型：内部一律用「分」存储，只在展示层转「元」。 */
export type Cents = number;

export function yuanToCents(yuan: string | number): Cents {
  const n = typeof yuan === 'number' ? yuan : Number.parseFloat(yuan.replace(/[^\d.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToYuan(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: Cents): string {
  return `¥${(Math.round(cents) / 100).toFixed(2)}`;
}

/** 解析 "− ¥1" / "+ ¥0" / "-1" 这类差价字符串，返回分。 */
export function parseDiffPrice(input: string | number | undefined | null): Cents {
  if (input == null) return 0;
  if (typeof input === 'number') return Math.round(input * 100);
  const sign = /^[-−]/.test(input.trim()) ? -1 : 1;
  const n = Number.parseFloat(input.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(sign * n * 100);
}
