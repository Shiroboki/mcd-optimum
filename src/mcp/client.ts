import { assertLiveReady, env } from '@/lib/env';
import { TraceRecorder } from '@/mcp/trace';

/**
 * 麦当劳官方 MCP 客户端（streamable-http / JSON-RPC 2.0）。
 *
 * 只允许在服务端使用：凭据从环境变量读取，浏览器侧永远拿不到。
 * 协议要点：先 initialize 建立会话，后续请求携带 Mcp-Session-Id。
 */

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    tools?: unknown[];
    [k: string]: unknown;
  };
  error?: { code: number; message: string };
}

export class McdMcpError extends Error {
  constructor(
    message: string,
    readonly tool: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'McdMcpError';
  }
}

export class McdMcpClient {
  private seq = 0;
  private sessionId: string | null = null;
  private initialized = false;
  readonly recorder: TraceRecorder;

  constructor(
    private readonly url: string = env.mcpUrl,
    private readonly token: string = env.mcpToken,
    recorder?: TraceRecorder,
  ) {
    this.recorder = recorder ?? new TraceRecorder();
  }

  static fromEnv(recorder?: TraceRecorder): McdMcpClient {
    assertLiveReady();
    return new McdMcpClient(env.mcpUrl, env.mcpToken, recorder);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  /** 兼容 JSON 与 SSE 两种响应体 */
  private parseBody(text: string): JsonRpcResponse {
    const trimmed = text.trim();
    if (!trimmed) throw new McdMcpError('MCP 返回空响应体', 'transport');
    if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcResponse;
    const dataLines: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') dataLines.push(payload);
      }
    }
    for (const payload of dataLines) {
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse;
        if (parsed.result || parsed.error) return parsed;
      } catch {
        /* 跳过非 JSON 事件 */
      }
    }
    throw new McdMcpError(`无法解析 MCP 响应: ${trimmed.slice(0, 160)}`, 'transport');
  }

  private async rpc(method: string, params: unknown): Promise<{ response: JsonRpcResponse; latencyMs: number }> {
    const started = Date.now();
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.seq, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const sessionHeader = res.headers.get('mcp-session-id');
    if (sessionHeader) this.sessionId = sessionHeader;
    const text = await res.text();
    if (!res.ok && !text.trim()) {
      throw new McdMcpError(`MCP HTTP ${res.status}`, 'transport', res.status);
    }
    return { response: this.parseBody(text), latencyMs: Date.now() - started };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcd-optimum', version: '0.1.0' },
    });
    this.initialized = true;
  }

  async listTools(): Promise<unknown[]> {
    await this.ensureInitialized();
    const { response } = await this.rpc('tools/list', {});
    if (response.error) throw new McdMcpError(response.error.message, 'tools/list', response.error.code);
    return response.result?.tools ?? [];
  }

  /**
   * 调用工具并把 MCP 的文本内容解析成业务 JSON。
   * 注意：麦当劳 MCP 的业务失败以 {success:false, code, message} 返回，不是 transport 异常。
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureInitialized();
    const started = Date.now();
    let latencyMs = 0;
    try {
      const { response, latencyMs: rpcLatency } = await this.rpc('tools/call', { name, arguments: args });
      latencyMs = rpcLatency;
      if (response.error) {
        throw new McdMcpError(response.error.message, name, response.error.code);
      }
      const content = response.result?.content ?? [];
      const raw = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      const payload = this.extractJson(raw);
      const ok = !(payload && typeof payload === 'object' && 'success' in payload && payload.success === false);
      const code = payload && typeof payload === 'object' && 'code' in payload ? Number(payload.code) : undefined;
      this.recorder.add({
        tool: name,
        args,
        ok,
        code,
        message: payload && typeof payload === 'object' && 'message' in payload ? String(payload.message) : undefined,
        latencyMs: Date.now() - started,
      });
      return (payload ?? raw) as T;
    } catch (err) {
      this.recorder.add({
        tool: name,
        args,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: latencyMs || Date.now() - started,
      });
      throw err;
    }
  }

  /** MCP 文本里可能是纯 JSON，也可能是「JSON + 展示提示」混排，取第一个完整 JSON 值。 */
  private extractJson(raw: string): unknown {
    const text = raw.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      /* fallthrough */
    }
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
