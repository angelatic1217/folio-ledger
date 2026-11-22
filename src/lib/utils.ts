import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CurrencyCode } from "@/types/sheet";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function withBasePath(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}

export function formatMoney(
  twdAmount: number,
  displayCurrency: CurrencyCode,
  fxRate: number,
  options?: { signed?: boolean; compact?: boolean }
): string {
  const value = displayCurrency === "TWD" ? twdAmount : twdAmount / (fxRate || 32);
  const abs = Math.abs(value);
  const prefix = displayCurrency === "TWD" ? "NT$ " : "$ ";
  const sign = value < 0 ? "-" : options?.signed && value > 0 ? "+" : "";

  if (options?.compact && abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  }
  const formatted = abs.toLocaleString("en-US", {
    maximumFractionDigits: displayCurrency === "TWD" ? 0 : 0,
  });
  return `${sign}${prefix}${formatted}`;
}

export function formatPrice(amount: number, currency: CurrencyCode): string {
  const prefix = currency === "USD" ? "$" : "NT$";
  return `${prefix}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(
  ratio: number | null | undefined,
  options?: { signed?: boolean; digits?: number }
): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  const digits = options?.digits ?? 2;
  const pct = (ratio * 100).toFixed(digits);
  const sign = options?.signed && ratio > 0 ? "+" : "";
  return `${sign}${pct}%`;
}
