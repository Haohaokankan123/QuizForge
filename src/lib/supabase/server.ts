// Supabase client for the SERVER — Server Components, Route Handlers, Server Actions.
//
// What this is: an async function that builds a Supabase client that runs on the
//   server and reads/writes the auth session through Next.js cookies.
// Why it exists: server code (pages rendered on the server, /api routes) needs to
//   know who is logged in. The session lives in cookies, so we hand Supabase a
//   cookie adapter so it can read the session and refresh tokens.
// Why async: in Next.js 16, cookies() is asynchronous, so we must await it.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// createClient: await this in any server component / route handler / server action.
// Example:  const supabase = await createClient();
export async function createClient() {
  // cookies() reads the incoming request's cookies. In Next.js 16 it is async.
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // getAll: hand Supabase every cookie on the request so it can find the
        // session token. This is the modern API — NOT the deprecated
        // get/set/remove single-cookie methods.
        getAll() {
          return cookieStore.getAll();
        },
        // setAll: Supabase calls this when it refreshes the session and needs to
        // write updated cookies back.
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // GOTCHA: Server Components are NOT allowed to set cookies — calling
            // cookieStore.set there throws. We swallow that error on purpose.
            // This is safe because the middleware (src/middleware.ts) refreshes
            // the session and writes cookies on every request, so the tokens
            // still get persisted there. Without this try/catch, rendering a
            // Server Component that triggers a token refresh would crash.
          }
        },
      },
    },
  );
}
