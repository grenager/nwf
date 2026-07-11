export function getSupabaseEnv(): { url: string; key: string } {
  const url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key: string | undefined =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return { url, key };
}
