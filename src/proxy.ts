// Next.js PROXY — runs before every matched request.
// (In Next.js 16 the old "middleware" file convention was renamed to "proxy";
//  functionality is identical. This file is src/proxy.ts and exports `proxy`.)
//
// What this does: keeps the user's auth session fresh. Supabase access tokens
//   expire; this is the one place that can refresh them and write the new
//   cookies back onto BOTH the request (so the current render sees them) and the
//   response (so the browser stores them). This is the official @supabase/ssr
//   Next.js pattern.
//
// What this does NOT do (on purpose): it does not redirect unauthenticated users
//   or protect routes. Per-page route gating is handled elsewhere. This file's
//   only job right now is session refresh + passing cookies through.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Start with a response that simply continues the request unchanged.
  // We keep a reference to it so the cookie adapter below can attach refreshed
  // auth cookies to it.
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // getAll: read every cookie off the incoming request so Supabase can
        // find the current session token.
        getAll() {
          return request.cookies.getAll();
        },
        // setAll: called when Supabase refreshes the session. We must write the
        // updated cookies to TWO places:
        setAll(cookiesToSet) {
          // 1) onto the request — so anything reading cookies later in THIS
          //    request (e.g. a Server Component) sees the fresh values.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // 2) onto a fresh response — so the new cookies are actually sent to
          //    the browser. We rebuild the response from the updated request.
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  // getUser() validates the token with the Supabase auth server and, if needed,
  // triggers the token refresh that fires the setAll callback above.
  await supabase.auth.getUser();

  // Return the (possibly cookie-updated) response so refreshed tokens reach the
  // browser. If you later add route protection, build redirects FROM this
  // response so you don't drop the refreshed auth cookies.
  return supabaseResponse;
}

export const config = {
  // matcher: which requests run this middleware. We run on everything EXCEPT:
  //   - _next/static  (build output / JS / CSS)
  //   - _next/image   (Next.js optimized images)
  //   - favicon.ico
  //   - common static image file types
  //   - /api          (API routes handle their own auth; skip session refresh here)
  // This keeps middleware off static assets (faster) while still refreshing the
  // session on real page navigations.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
