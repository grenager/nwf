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
    pathname === "/" || pathname === "/signin" || pathname.startsWith("/auth");

  const redirectTo = (target: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    const redirect = NextResponse.redirect(url);
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
