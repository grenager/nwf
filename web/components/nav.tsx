"use client";

import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS: { href: string; label: string }[] = [
  { href: "/feed", label: "Feed" },
  { href: "/reader", label: "Reader" },
  { href: "/sources", label: "Sources" },
  { href: "/friends", label: "Friends" },
];

export function Nav() {
  const pathname: string = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { notify } = useToast();

  async function handleSignOut(): Promise<void> {
    await signOut();
    notify("Signed out", "info");
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/feed" className="text-lg font-bold text-brand-600">
          NewsWithFriends
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active: boolean = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand-100 text-brand-700 dark:bg-slate-800 dark:text-brand-500"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-500 sm:inline">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
