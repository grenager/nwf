"use client";

import { BrandLink } from "@/components/brand-mark";
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

  const [email, setEmail] = useState<string>(presetEmail);
  const [sent, setSent] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  async function handleGoogleSignIn(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo: string =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
          : "";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to sign in with Google", "error");
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedEmail: string = email.trim();
    if (!trimmedEmail || busy) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo: string =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
          : "";
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { emailRedirectTo: redirectTo },
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
      <BrandLink
        className="mb-8 justify-center text-2xl font-bold text-zinc-900 dark:text-zinc-50"
        markClassName="h-7 w-7"
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold">
          {isInvite ? "Join your friend's conversation" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isInvite
            ? "We'll email you a magic link so you can sign in and accept the invitation — no password needed."
            : "Enter your email for a magic link — no password needed."}
        </p>

        {sent ? (
          <div className="mt-6 border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            Check <strong>{email}</strong> for your sign-in link. Click it to
            verify your email and finish signing in.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.74Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3a7.4 7.4 0 0 1-4.07 1.14c-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4-3.11Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
                />
              </svg>
              Sign in with Google
            </button>
            <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              or use email
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:border-zinc-400 dark:focus:ring-zinc-700 dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 font-semibold text-zinc-900 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-zinc-50 dark:hover:bg-slate-700"
              >
                {busy ? "Sending…" : "Send magic link"}
              </button>
            </form>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-sm text-slate-500">
        Pre-created accounts: sign in with the same email to claim them.
      </p>
      <p className="mt-6 text-center text-xs text-slate-400">
        By signing in, you agree to our{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
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
