"use client";

import { useAuth } from "@/components/auth-provider";
import { FriendsSidebar } from "@/components/friends-sidebar";
import { Nav } from "@/components/nav";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/signin");
    }
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Redirecting to sign in…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <main className="min-w-0 flex-1">{children}</main>
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-20">
            <FriendsSidebar />
          </div>
        </aside>
      </div>
    </div>
  );
}
