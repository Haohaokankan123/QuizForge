// Supabase client for CLIENT COMPONENTS (anything with "use client" at the top).
//
// What this is: a function that builds a Supabase client that runs in the browser.
// Why it exists: client components need to talk to Supabase (sign in, sign up,
//   read the logged-in user) directly from the user's browser.
// What it uses: the PUBLIC env vars. Both are safe to expose in the browser —
//   the anon key only allows what your Row Level Security (RLS) policies allow.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// createClient: call this inside any client component to get a Supabase client.
// We make a NEW client per call (cheap) instead of a shared singleton so every
// component gets a client wired to the current browser cookies.
export function createClient() {
  return createBrowserClient(
    // The "!" tells TypeScript "trust me, this value exists at runtime".
    // These are set in .env.local and start with NEXT_PUBLIC_ so Next.js
    // inlines them into the browser bundle.
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Safely read the current user in the browser.
 *
 * WHY THIS EXISTS: a stale/expired auth cookie (common after a session expires
 * or a previous login is left behind) makes Supabase try to refresh the token;
 * the server replies "Invalid Refresh Token: Refresh Token Not Found" and
 * `getUser()` THROWS. Unhandled, that error pops the Next.js dev error overlay
 * (and is just noise in production). This helper catches it, CLEARS the bad
 * session (so the dead cookie is removed and the error doesn't recur), and
 * returns null — i.e. "treat them as logged out", the correct outcome for an
 * unusable token.
 *
 * Use this everywhere the app reads the user on the client, instead of calling
 * `supabase.auth.getUser()` directly.
 */
export async function getUserSafe(
  supabase: SupabaseClient,
): Promise<User | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      await supabase.auth.signOut().catch(() => {});
      return null;
    }
    return data.user ?? null;
  } catch {
    await supabase.auth.signOut().catch(() => {});
    return null;
  }
}
