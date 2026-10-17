/**
 * 运行配置。所有敏感值只从环境变量读取，代码中不出现任何真实凭据。
 * 该模块只允许在服务端（Node runtime）导入。
 */
export type RunMode = 'mock' | 'live';

const rawMode = (process.env.MCD_MODE ?? 'mock').toLowerCase();

export const env = {
  /** mock = 使用脱敏 fixtures 离线演示；live = 直连麦当劳 MCP */
  mode: (rawMode === 'live' ? 'live' : 'mock') as RunMode,
  mcpUrl: process.env.MCD_MCP_URL ?? 'https://mcp.mcd.cn',
  mcpToken: process.env.MCD_MCP_TOKEN ?? '',
  defaultStoreCode: process.env.MCD_DEFAULT_STORE_CODE ?? '3230323',
  defaultAddressId: process.env.MCD_DEFAULT_ADDRESS_ID ?? '',
  /** 单个优化请求允许的 calculate-price 调用上限（成本护栏） */
  priceCallBudget: Number(process.env.MCD_PRICE_CALL_BUDGET ?? 32),
} as const;

export function assertLiveReady(): void {
  if (env.mode === 'live' && !env.mcpToken) {
    throw new Error(
      'MCD_MODE=live 但缺少 MCD_MCP_TOKEN。请复制 .env.example 为 .env.local 并填写，或改用 MCD_MODE=mock。',
    );
  }
  if (env.mode === 'live' && !/^https:\/\//.test(env.mcpUrl)) {
    throw new Error('MCD_MCP_URL 必须是 https 地址');
  }
}
