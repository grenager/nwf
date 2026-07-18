"use client";

import { FriendsSidebar } from "@/components/friends-sidebar";
import { Nav } from "@/components/nav";
import type { ReactNode } from "react";

export default function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <Nav />
      <div className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 gap-0 px-4 lg:px-8">
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-6 pt-2 max-sm:pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
          {children}
        </main>
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-zinc-200 py-6 pl-8 lg:block dark:border-zinc-800">
          <FriendsSidebar />
        </aside>
      </div>
      {modal}
    </div>
  );
}
