"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { PrivacyProvider } from "@/lib/privacy/context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <PrivacyProvider>{children}</PrivacyProvider>
    </ThemeProvider>
  );
}
