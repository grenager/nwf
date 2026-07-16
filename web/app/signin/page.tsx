"use client";

import { useToast } from "@/components/toast";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function SignInForm() {
  const { notify } = useToast();
  const searchParams = useSearchParams();
  const nextPath: string = (() => {
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    return "/";
  })();
  const presetEmail: string = searchParams.get("email")?.trim() ?? "";
  const isInvite: boolean = nextPath.startsWith("/invite/");

  const [first, setFirst] = useState<string>("");
  const [last, setLast] = useState<string>("");
  const [email, setEmail] = useState<string>(presetEmail);
  const [sent, setSent] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedEmail: string = email.trim();
    const trimmedFirst: string = first.trim();
    const trimmedLast: string = last.trim();
    if (!trimmedEmail || busy) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo: string =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
          : "";
      const meta: Record<string, string> = {};
      if (trimmedFirst) meta.first = trimmedFirst;
      if (trimmedLast) meta.last = trimmedLast;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: redirectTo,
          ...(Object.keys(meta).length > 0 ? { data: meta } : {}),
        },
      });
      if (error) throw error;
      setSent(true);
      notify("Magic link sent — check your email", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to send link", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-center text-2xl font-bold text-brand-600">
        NewsWithFriends
      </Link>
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold">
          {isInvite ? "Join your friend's conversation" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isInvite
            ? "We'll email you a magic link so you can sign in and accept the invitation — no password needed."
            : "Enter your email for a magic link. New accounts can add a name; existing accounts just need email."}
        </p>

        {sent ? (
          <div className="mt-6 border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            Check <strong>{email}</strong> for your sign-in link. Click it to
            verify your email and finish signing in.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="First name (optional)"
                autoComplete="given-name"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                value={last}
                onChange={(e) => setLast(e.target.value)}
                placeholder="Last name (optional)"
                autoComplete="family-name"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-sm text-slate-500">
        Pre-created accounts: sign in with the same email to claim them.
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-center text-sm text-slate-500">Loading…</p>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
