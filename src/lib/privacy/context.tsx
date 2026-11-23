"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatMoney } from "@/lib/utils";
import type { CurrencyCode } from "@/types/sheet";

const STORAGE_KEY = "folio-ledger-privacy-mode";

interface PrivacyContextValue {
  privacyMode: boolean;
  setPrivacyMode: (value: boolean) => void;
  togglePrivacyMode: () => void;
  fmtMoney: (
    twdAmount: number,
    displayCurrency: CurrencyCode,
    fxRate: number,
    options?: { signed?: boolean; compact?: boolean }
  ) => string;
  fmtUsd: (usdAmount: number, options?: { minDigits?: number; maxDigits?: number }) => string;
  fmtShares: (
    shares: number,
    options?: { maxDigits?: number; signed?: boolean }
  ) => string;
  fmtMask: (value: string, placeholder?: string) => string;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyModeState] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") {
        setPrivacyModeState(true);
      }
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const setPrivacyMode = useCallback((value: boolean) => {
    setPrivacyModeState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const togglePrivacyMode = useCallback(() => {
    setPrivacyModeState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }, []);

  // Keyboard shortcut: Shift + P toggles privacy mode when not typing in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      togglePrivacyMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePrivacyMode]);

  const value = useMemo<PrivacyContextValue>(() => {
    return {
      privacyMode,
      setPrivacyMode,
      togglePrivacyMode,
      fmtMoney: (twdAmount, displayCurrency, fxRate, options) => {
        if (privacyMode) {
          return displayCurrency === "TWD" ? "NT$ •••••" : "$ •••••";
        }
        return formatMoney(twdAmount, displayCurrency, fxRate, options);
      },
      fmtUsd: (usdAmount, options) => {
        if (privacyMode) return "$ •••••";
        return `$${usdAmount.toLocaleString("en-US", {
          minimumFractionDigits: options?.minDigits ?? 2,
          maximumFractionDigits: options?.maxDigits ?? 2,
        })}`;
      },
      fmtShares: (shares, options) => {
        if (privacyMode) return "••••";
        const sign = options?.signed && shares > 0 ? "+" : "";
        return `${sign}${shares.toLocaleString("en-US", {
          maximumFractionDigits: options?.maxDigits ?? 4,
        })}`;
      },
      fmtMask: (text, placeholder = "•••••") => (privacyMode ? placeholder : text),
    };
  }, [privacyMode, setPrivacyMode, togglePrivacyMode]);

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (ctx) return ctx;
  // Safe fallback for isolated unit tests rendered without Provider
  return {
    privacyMode: false,
    setPrivacyMode: () => {},
    togglePrivacyMode: () => {},
    fmtMoney: formatMoney,
    fmtUsd: (usdAmount, options) =>
      `$${usdAmount.toLocaleString("en-US", {
        minimumFractionDigits: options?.minDigits ?? 2,
        maximumFractionDigits: options?.maxDigits ?? 2,
      })}`,
    fmtShares: (shares, options) => {
      const sign = options?.signed && shares > 0 ? "+" : "";
      return `${sign}${shares.toLocaleString("en-US", {
        maximumFractionDigits: options?.maxDigits ?? 4,
      })}`;
    },
    fmtMask: (text) => text,
  };
}
