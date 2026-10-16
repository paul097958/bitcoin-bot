import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '加密貨幣 AI 交易儀表板',
  description: '即時監控機器人持倉與 AI 分析報告',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}