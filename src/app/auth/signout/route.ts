// Sign-out Route Handler (POST only).
//
// What this is: the endpoint a "Sign out" button/form POSTs to.
// What it does: clears the Supabase session (deletes the auth cookies via the
//   server client's setAll adapter), then redirects home (/).
// Why POST (not GET): sign-out changes state. A GET could be triggered by a
//   prefetch, an <img> tag, or a link-prefetcher and log the user out by
//   accident. Requiring POST means it only runs on a deliberate form submit.
//
// The middleware matcher excludes /auth, so this handler does its own auth work
// using the SERVER client (async — must be awaited).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  // Only sign out if there's actually a session — avoids a pointless network
  // call for an already-anonymous visitor.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.auth.signOut();
  }

  // Redirect to the landing page. 303 forces the browser to follow with GET
  // (the default for redirect() is fine, but 303 is the correct status after a
  // POST so the browser doesn't try to re-POST to "/").
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
