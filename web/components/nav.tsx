"use client";

import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS: { href: string; label: string }[] = [
  { href: "/today", label: "Today" },
  { href: "/sources", label: "Sources" },
];

export function Nav() {
  const pathname: string = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { notify } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    api
      .getMe()
      .then((me) => {
        if (active) setIsAdmin(me.is_admin);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  async function handleSignOut(): Promise<void> {
    await signOut();
    notify("Signed out", "info");
    router.push("/");
  }

  function linkClass(active: boolean): string {
    return `px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-brand-100 text-brand-700 dark:bg-slate-800 dark:text-brand-500"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/today" className="text-lg font-bold text-brand-600">
          NewsWithFriends
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(pathname === link.href)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          <span className="hidden text-xs text-slate-500 md:inline">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 sm:hidden"
        >
          <span className="text-xl">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </div>

      {menuOpen ? (
        <nav className="flex flex-col border-t border-slate-200 px-2 py-2 dark:border-slate-800 sm:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(pathname === link.href)}
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={handleSignOut}
            className="mt-1 px-3 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </nav>
      ) : null}
    </header>
  );
}
