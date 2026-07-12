import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Refresh the Supabase session on each request (prevents random sign-outs). */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const { url, key } = getSupabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic: boolean =
    pathname === "/" ||
    pathname === "/signin" ||
    pathname.startsWith("/auth") ||
    pathname === "/today" ||
    pathname.startsWith("/today/");

  const redirectTo = (target: string): NextResponse => {
    // Behind Railway's proxy the request host/port is the internal
    // `localhost:<port>`; prefer the forwarded host so redirects stay on the
    // public domain (and don't leak the internal port).
    const forwardedHost: string | null = request.headers.get("x-forwarded-host");
    const base: string = forwardedHost
      ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`
      : request.nextUrl.origin;
    const redirect = NextResponse.redirect(new URL(target, base));
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  };

  if (user && (pathname === "/" || pathname === "/signin")) {
    return redirectTo("/today");
  }

  if (!user && !isPublic) {
    return redirectTo("/signin");
  }

  return supabaseResponse;
}
