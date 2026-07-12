import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "@/lib/supabase/env";

type ServerClient = ReturnType<typeof createServerClient>;
type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createSupabaseServerClient(): Promise<ServerClient> {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies; middleware handles refresh.
        }
      },
    },
  });
}
