import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}

/**
 * Public origin of the request. Behind Railway's proxy the raw request URL
 * resolves to the internal `localhost:<port>`, so prefer the forwarded host
 * headers when present to avoid redirecting users off-site.
 */
function publicOrigin(request: Request, fallbackOrigin: string): string {
  const forwardedHost: string | null = request.headers.get("x-forwarded-host");
  if (!forwardedHost) {
    return fallbackOrigin;
  }
  const forwardedProto: string = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code: string | null = searchParams.get("code");
  const next: string = safeNextPath(searchParams.get("next"));
  const base: string = publicOrigin(request, origin);

  if (code) {
    const cookieStore = await cookies();
    const { url, key } = getSupabaseEnv();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/signin`);
}
