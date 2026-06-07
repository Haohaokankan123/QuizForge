"use client";

/**
 * AuthGuard — client-side redirect guard for protected app pages.
 *
 * What it does: on mount, asks the browser Supabase client whether someone is
 * logged in. While that check runs it shows a centered spinner. If no user, it
 * redirects to /login. Once a user is confirmed, it renders its children.
 *
 * Why this exists: /generate, /dashboard, /flashcards are client components.
 * Rather than restructure them into server components / route groups (which
 * would change URLs and imports), we wrap each page body in <AuthGuard> for a
 * clean UX redirect when signed out.
 *
 * This is a UX convenience, NOT the security boundary. Real enforcement lives
 * server-side: Supabase Row Level Security on every table, plus the auth check
 * in /api/generate. A user with JS disabled or who pokes the client can't read
 * or write another user's data — RLS forbids it regardless of this guard.
 *
 * Accessibility / motion: the only animation is a CSS spin on the spinner,
 * which respects the global `prefers-reduced-motion` rule in globals.css
 * (`* { animation: none }`), so it is reduced-motion safe by construction.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** What the guard currently knows about the viewer. */
type AuthState = "checking" | "authed";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Start in "checking" so we never flash protected content before we know.
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    // `active` guards against setting state after unmount (e.g. fast navigation).
    let active = true;
    const supabase = createClient();

    async function check() {
      // getUser() validates the session with Supabase (not just the local cookie).
      // Wrap in try/catch: if the auth endpoint is unreachable (network drop,
      // Supabase down), we must NOT hang on the spinner forever. Treating
      // "can't verify" as "not signed in" is the safe choice — real enforcement
      // is server-side RLS, so the worst case is a needless trip to /login.
      let user = null;
      try {
        const { data } = await supabase.auth.getUser();
        user = data.user;
      } catch {
        if (!active) return;
        router.replace("/login");
        return;
      }

      if (!active) return;

      if (!user) {
        // replace (not push) so the protected URL isn't left in history — the
        // back button shouldn't bounce the user back to a page they can't view.
        router.replace("/login");
        return;
      }

      setState("authed");
    }

    void check();

    return () => {
      active = false;
    };
  }, [router]);

  if (state === "checking") {
    return (
      <main
        className="flex min-h-[60dvh] items-center justify-center px-4"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-3 text-sm text-foreground-muted">
          <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
          Checking your session…
        </span>
      </main>
    );
  }

  return <>{children}</>;
}
