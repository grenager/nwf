import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

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

/**
 * Memoized per-request. A Server Component can't persist a refreshed
 * session back to cookies (see the catch above), so two independent
 * `createSupabaseServerClient()` + `getUser()` calls in the same request
 * can race a token refresh and disagree on whether there's a user.
 * Callers within one request must share this instead of calling
 * `getUser()` directly, so layout and page always agree.
 */
export const getServerUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
