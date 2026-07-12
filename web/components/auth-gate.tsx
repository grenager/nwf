"use client";

import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface AuthGateContextValue {
  requireAuth: (actionLabel: string) => boolean;
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null);

export function useAuthGate(): AuthGateContextValue {
  const ctx = useContext(AuthGateContext);
  if (ctx === null) {
    throw new Error("useAuthGate must be used within AuthGateProvider");
  }
  return ctx;
}

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const requireAuth = useCallback(
    (label: string): boolean => {
      if (session) return true;
      setActionLabel(label);
      return false;
    },
    [session],
  );

  const value = useMemo<AuthGateContextValue>(
    () => ({ requireAuth }),
    [requireAuth],
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      {actionLabel ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setActionLabel(null)}
        >
          <div
            className="w-full max-w-md border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Create a free account
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Create a free account and verify your email to {actionLabel}.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              We&apos;ll send you a magic link — no password needed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionLabel(null)}
                className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Not now
              </button>
              <Link
                href="/signin"
                className="bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Create free account
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </AuthGateContext.Provider>
  );
}
