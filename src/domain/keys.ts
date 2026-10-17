import { normalizeName } from '@/domain/catalog';

/** 商品对齐用的稳定 key（与 catalog.normalizeName 保持一致，避免循环依赖）。 */
export function normalizedProductKey(name: string): string {
  return normalizeName(name);
}
