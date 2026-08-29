"use client";

import { ModalShell } from "@/components/modal-shell";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
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
        <ModalShell
          onClose={() => setActionLabel(null)}
          label="Create a free account"
          onTop
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
              href={`/signin?next=${encodeURIComponent(pathname)}`}
              onClick={() => setActionLabel(null)}
              className="bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create free account
            </Link>
          </div>
        </ModalShell>
      ) : null}
    </AuthGateContext.Provider>
  );
}
