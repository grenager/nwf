"use client";

import { createBrowserClient } from "@supabase/ssr";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let client: BrowserClient | null = null;

/** Return a singleton browser Supabase client (session/auth only). */
export function getSupabaseBrowserClient(): BrowserClient {
  if (client) return client;

  const url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  client = createBrowserClient(url, anonKey);
  return client;
}
