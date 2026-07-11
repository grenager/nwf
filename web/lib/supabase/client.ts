"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let client: BrowserClient | null = null;

/** Singleton browser Supabase client (session/auth only). */
export function getSupabaseBrowserClient(): BrowserClient {
  if (client) return client;

  const { url, key } = getSupabaseEnv();
  client = createBrowserClient(url, key);
  return client;
}
