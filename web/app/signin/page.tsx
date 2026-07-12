"use client";

import { useToast } from "@/components/toast";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import Link from "next/link";
import { useState } from "react";

export default function SignInPage() {
  const { notify } = useToast();
  const [first, setFirst] = useState<string>("");
  const [last, setLast] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [sent, setSent] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedFirst: string = first.trim();
    const trimmedLast: string = last.trim();
    if (!trimmedFirst || !trimmedLast || !email || busy) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo: string =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=/`
          : "";
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          data: { first: trimmedFirst, last: trimmedLast },
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
        <h1 className="text-xl font-bold">Create your free account</h1>
        <p className="mt-1 text-sm text-slate-500">
          We&apos;ll email you a magic link to verify your address — no password
          needed.
        </p>

        {sent ? (
          <div className="mt-6 border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            Check <strong>{email}</strong> for your sign-in link. Click it to
            verify your email and finish setting up your account.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="First name"
                autoComplete="given-name"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                required
                value={last}
                onChange={(e) => setLast(e.target.value)}
                placeholder="Last name"
                autoComplete="family-name"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800"
            />
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
        Already have an account? Use the same form — we&apos;ll send you a link.
      </p>
    </main>
  );
}
