import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "FolioLedger — 個人量化投資組合與水下風控系統",
  description:
    "Local-First 個人投資組合績效與風控分析平台：Modified Dietz、Daily TWR、最大回撤 (MDD)、水下深度圖與美股匯率歸因。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
