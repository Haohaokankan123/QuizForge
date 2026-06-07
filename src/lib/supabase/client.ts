// Supabase client for CLIENT COMPONENTS (anything with "use client" at the top).
//
// What this is: a function that builds a Supabase client that runs in the browser.
// Why it exists: client components need to talk to Supabase (sign in, sign up,
//   read the logged-in user) directly from the user's browser.
// What it uses: the PUBLIC env vars. Both are safe to expose in the browser —
//   the anon key only allows what your Row Level Security (RLS) policies allow.

import { createBrowserClient } from "@supabase/ssr";

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
