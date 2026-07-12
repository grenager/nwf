"use client";

import { AuthGateProvider } from "@/components/auth-gate";
import { AuthProvider } from "@/components/auth-provider";
import { ToastProvider } from "@/components/toast";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGateProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthGateProvider>
    </AuthProvider>
  );
}
