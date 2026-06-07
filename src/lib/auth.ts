// Server-side auth helpers — Server Components, Route Handlers, Server Actions.
//
// What this is: three async functions that answer "who is logged in?" on the
//   server, using the cookie-based Supabase server client (@/lib/supabase/server).
// Why it exists: server code needs the current user to gate pages, fetch
//   per-user data, and tailor UI. The session lives in cookies; the server
//   client reads it. These helpers wrap that so callers don't repeat boilerplate.
//
// IMPORTANT: this is server-only. Never import it from a "use client" file —
// it pulls in next/headers (via the server client) which only runs on the server.

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The shape of a profiles row we care about for gating + display.
 * The DB has more columns (created_at); we read only what the UI needs.
 */
export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  is_owner: boolean;
}

/**
 * requireUser — use at the top of a protected Server Component / Route Handler.
 *
 * Returns the logged-in user. If there is NO user, it redirects to /login and
 * never returns (redirect() throws a special control-flow signal Next.js
 * catches), so callers can safely treat the return value as a non-null User.
 *
 * Why getUser() (not getSession()): getUser() re-validates the token with the
 * Supabase auth server, so a forged/expired cookie can't pass. getSession()
 * trusts the cookie as-is and is not safe for authorization decisions.
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * getOptionalUser — returns the logged-in user, or null if signed out.
 *
 * Use on pages that render for both signed-in and signed-out visitors (e.g. to
 * show an account menu vs. a "Sign in" link) where you do NOT want to redirect.
 */
export async function getOptionalUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
}

/**
 * getProfile — read a user's profiles row (is_owner / display_name / email).
 *
 * Returns null if the row isn't found or the read fails (e.g. RLS). The profiles
 * row is created by the on_auth_user_created DB trigger when a user signs up.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, is_owner")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Profile;
}
