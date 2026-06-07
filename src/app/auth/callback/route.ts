// OAuth / email-confirmation callback Route Handler.
//
// What this is: the URL Supabase sends the user back to after they (a) click
//   "Continue with Google" and approve, or (b) click the confirm link in a
//   sign-up email. In both PKCE flows Supabase appends a one-time `?code=...`.
// What it does: exchanges that code for a real session (writes the auth cookies
//   via the server client's setAll adapter), then redirects into the app.
// Why it exists: without exchanging the code there is no session — the user
//   would land back on the app still logged out.
//
// runtime: this is a Route Handler under /api-style routing; the middleware
//   matcher excludes /auth, so this handler is responsible for its own session
//   work. It uses the SERVER client (cookie-aware) — which is async, so we await.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Where to send the user after a successful exchange. We only honour a
  // RELATIVE ?next= (must start with "/") so an attacker can't craft a link
  // that bounces the freshly-authenticated user to an external site.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/generate";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // In production a load balancer may rewrite the host; trust
      // x-forwarded-host so the redirect points at the user-facing origin.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange failed — bounce back to the login screen with a
  // flag the page can read to show a friendly "couldn't finish sign-in" notice.
  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
