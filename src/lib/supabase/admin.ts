// Supabase ADMIN client — SERVER ONLY. Uses the service-role key.
//
// ⚠️ DANGER: This client uses SUPABASE_SERVICE_ROLE_KEY, which BYPASSES Row Level
//   Security (RLS). It can read and write EVERY row in EVERY table, ignoring all
//   policies. NEVER import this file from client code ("use client") and NEVER
//   expose the service-role key to the browser. If this key ever reaches the
//   browser, anyone can read/modify your entire database.
//
// What this is: a plain supabase-js client (no cookies / no user session) that
//   acts as the project owner.
// Why it exists: some server tasks need full access — e.g. owner-only admin
//   operations, background jobs, or writing data on behalf of any user.
// When to use: ONLY in trusted server code (route handlers, server actions) and
//   only when you specifically need to bypass RLS. For normal "act as the logged-in
//   user" work, use server.ts instead.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// createAdminClient: returns the privileged client. Throws early (fail loud) if
// the required secrets are missing, so misconfiguration is caught immediately
// instead of silently producing a broken client.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Note: NO "NEXT_PUBLIC_" prefix — this stays server-only and is never bundled
  // into the browser. That is exactly what keeps the service-role key secret.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL is missing from the environment.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "createAdminClient: SUPABASE_SERVICE_ROLE_KEY is missing from the environment.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      // The admin client has no user session and should never try to persist or
      // refresh one — it authenticates purely via the service-role key.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
