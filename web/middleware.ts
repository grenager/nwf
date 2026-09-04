import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // manifest.webmanifest is excluded for the same reason the images are: it
  // is a static asset with no session to refresh, and browsers fetch it
  // without credentials — left in, an unauthenticated fetch is redirected to
  // /signin and the home screen install silently gets no icon or app name.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
