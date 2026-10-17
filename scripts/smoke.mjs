/**
 * MCP 连通性冒烟测试（只读）。
 *
 * 用法：
 *   MCD_MCP_URL=https://mcp.mcd.cn MCD_MCP_TOKEN=xxx node scripts/smoke.mjs
 *
 * 只调用只读工具，不会下单、不会扣积分、不会领券。
 * 输出全部经过脱敏，可以安全地贴进 issue / 文档。
 */

const url = process.env.MCD_MCP_URL ?? 'https://mcp.mcd.cn';
const token = process.env.MCD_MCP_TOKEN ?? '';
const storeCode = process.env.MCD_DEFAULT_STORE_CODE ?? '3230323';

if (!token) {
  console.error('[smoke] 缺少 MCD_MCP_TOKEN，请先导出环境变量。');
  process.exit(1);
}

let seq = 0;
let sessionId = null;

function mask(value) {
  return String(value)
    .replace(/MCD[0-9A-Z]{8,}/g, '***')
    .replace(/\b1[3-9]\d{9}\b/g, '***')
    .slice(0, 120);
}

function parseBody(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const parsed = JSON.parse(line.slice(5).trim());
      if (parsed.result || parsed.error) return parsed;
    } catch {
      /* ignore */
    }
  }
  throw new Error('无法解析响应体');
}

async function rpc(method, params) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  return parseBody(await res.text());
}

async function callTool(name, args) {
  const started = Date.now();
  const payload = await rpc('tools/call', { name, arguments: args });
  if (payload.error) {
    console.log(`❌ ${name} | rpc error ${payload.error.message}`);
    return null;
  }
  const text = (payload.result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const first = text.indexOf('{');
  let data = null;
  if (first >= 0) {
    try {
      data = JSON.parse(text.slice(first));
    } catch {
      /* 文本型响应 */
    }
  }
  const ok = !(data && data.success === false);
  console.log(
    `${ok ? '✅' : '⚠️'} ${name.padEnd(28)} ${String(Date.now() - started).padStart(5)} ms`,
  );
  if (data && data.success === false) console.log(`     ↳ ${data.code} ${mask(data.message)}`);
  return data;
}

async function main() {
  console.log(`[smoke] target=${url} storeCode=${storeCode}`);
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcd-optimum-smoke', version: '0.1.0' },
  });
  console.log(`[smoke] initialize: ${init.result ? 'ok' : 'failed'}`);

  const tools = await rpc('tools/list', {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  console.log(`[smoke] tools: ${names.length} 个 → ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' …' : ''}`);

  await callTool('now-time-info', {});
  await callTool('query-my-account', {});
  await callTool('query-my-coupons', {});
  await callTool('query-lottery-info', {});
  await callTool('query-nearby-stores', { beType: 1, searchType: 1 });
  await callTool('query-meals', { storeCode, orderType: 1, beType: 1 });
  await callTool('calculate-price', {
    storeCode,
    orderType: 1,
    beType: 1,
    items: [{ productCode: '1100', quantity: 1 }],
  });
  await callTool('list-nutrition-foods', {});

  console.log('[smoke] done. 以上调用均为只读，未产生订单/积分变动。');
}

main().catch((err) => {
  console.error('[smoke] 失败:', err.message);
  process.exit(1);
});
