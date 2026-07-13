"use client";

import { FriendsSidebar } from "@/components/friends-sidebar";
import { Nav } from "@/components/nav";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Nav />
      <div className="mx-auto flex max-w-7xl gap-0 px-4 py-6">
        <main className="min-w-0 flex-1">{children}</main>
        <aside className="hidden w-72 shrink-0 border-l border-zinc-200 pl-6 lg:block dark:border-zinc-800">
          <div className="sticky top-20">
            <FriendsSidebar />
          </div>
        </aside>
      </div>
    </div>
  );
}
