"use client";

import { AuthProvider } from "@/components/auth-provider";
import { ToastProvider } from "@/components/toast";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}
