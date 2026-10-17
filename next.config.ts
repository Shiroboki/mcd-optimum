import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 麦当劳 MCP 只在服务端调用，浏览器拿不到任何凭据。
  serverExternalPackages: [],
};

export default nextConfig;
