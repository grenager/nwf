import { FriendsSidebar } from "@/components/friends-sidebar";
import { Nav } from "@/components/nav";
import { StandardsProvider } from "@/components/standards-context";
import { StandardsStrip } from "@/components/standards-strip";
import { OnboardingGate } from "@/components/onboarding-gate";
import { getServerUser } from "@/lib/supabase/server";
import type { ReactNode } from "react";

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  const user = await getServerUser();

  if (!user) {
    return (
      <>
        {children}
        {modal}
      </>
    );
  }

  return (
    <OnboardingGate>
      <StandardsProvider>
        <div className="flex min-h-dvh flex-col bg-white lg:h-screen lg:overflow-hidden dark:bg-zinc-950">
          <Nav />
          {/* Outside the feed column so it spans the window, and outside the
            lg scroll container so it simply never moves there. */}
          <StandardsStrip />
          <div className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 gap-0 px-4 max-sm:px-0 lg:px-8">
            <main className="min-h-0 min-w-0 flex-1 pb-6 pt-2 max-sm:px-3 max-sm:pb-[calc(4.5rem+env(safe-area-inset-bottom))] max-sm:pt-[calc(0.5rem+var(--top-inset))] lg:overflow-x-hidden lg:overflow-y-auto">
              {children}
            </main>
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-zinc-200 py-6 pl-8 lg:block dark:border-zinc-800">
              <FriendsSidebar />
            </aside>
          </div>
          {modal}
        </div>
      </StandardsProvider>
    </OnboardingGate>
  );
}
