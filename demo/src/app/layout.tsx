import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'McOptimum 麦麦最优解',
  description: '基于麦当劳官方 MCP 的跨渠道 × 跨资产最优下单引擎（参赛项目）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
