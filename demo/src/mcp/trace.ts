import type { TraceEntry } from '@/lib/types';

/**
 * 调用链记录 + 脱敏。
 * 参赛要求：可以公开真实调用证据，但绝不允许泄露凭据与个人隐私。
 */

const SENSITIVE_KEY = /(token|authorization|cookie|coupon_?code|phone|mobile|address_?id|account_?id|fullAddress)/i;

/** 常见敏感值形态：MCD 券码、11 位手机号、超长数字 ID。 */
const SENSITIVE_VALUE = [
  /\bMCD[0-9A-Z]{8,}\b/g, // couponCode
  /\b1[3-9]\d{9}\b/g, // 手机号
];

const MAX_STRING = 240;

function maskValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key) && value != null && value !== '') {
    if (Array.isArray(value)) return value.map(() => '***');
    if (typeof value === 'object') return '***';
    return '***';
  }
  return value;
}

function scrubString(input: string): string {
  let out = input;
  for (const re of SENSITIVE_VALUE) out = out.replace(re, '***');
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…(truncated)`;
  return out;
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '<max-depth>';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(k, sanitize(v, depth + 1));
    }
    return out;
  }
  return value;
}

export class TraceRecorder {
  private entries: TraceEntry[] = [];

  add(entry: Omit<TraceEntry, 'at' | 'args'> & { args: unknown }): void {
    this.entries.push({
      at: new Date().toISOString(),
      ...entry,
      args: sanitize(entry.args),
    });
  }

  list(): TraceEntry[] {
    return [...this.entries];
  }

  /** 仅统计业务失败（非 200 业务码）数量，用于护栏观测 */
  failureCount(): number {
    return this.entries.filter((e) => !e.ok).length;
  }
}
