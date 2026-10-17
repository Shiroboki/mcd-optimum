import type { McdGateway } from '@/domain/gateway';
import { MockGateway } from '@/domain/mock-gateway';
import { LiveGateway } from '@/domain/live-gateway';
import { env } from '@/lib/env';

/**
 * 网关工厂：mock / live 切换只发生在这一处，优化器完全无感。
 * 这让「评审无需凭据即可复现完整决策」成为可能。
 */
export function createGateway(storeCode: string, addressId?: string): McdGateway {
  if (env.mode === 'live') return new LiveGateway(storeCode, addressId);
  return new MockGateway();
}
