import { describe, expect, it } from 'vitest';
import { centsToYuan, formatCents, parseDiffPrice, yuanToCents } from '@/lib/units';

describe('units: 分/元双单位', () => {
  it('元→分 四舍五入', () => {
    expect(yuanToCents('26.5')).toBe(2650);
    expect(yuanToCents(9.9)).toBe(990);
    expect(yuanToCents('¥11.10')).toBe(1110);
  });

  it('分→元 展示', () => {
    expect(centsToYuan(4710)).toBe(47.1);
    expect(formatCents(3600)).toBe('¥36.00');
  });

  it('解析套餐 diffPrice（含全角减号与货币符号）', () => {
    expect(parseDiffPrice('+ ¥0')).toBe(0);
    expect(parseDiffPrice('- ¥1')).toBe(-100);
    expect(parseDiffPrice('− ¥1')).toBe(-100);
    expect(parseDiffPrice(undefined)).toBe(0);
  });
});
