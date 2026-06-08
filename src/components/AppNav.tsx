"use client";

/**
 * AppNav — shared top navigation header for the inner app pages.
 *
 * A sticky, glass top bar with the QuizForge wordmark (links to /) on the left
 * and the primary destinations on the right: "New quiz" (/generate) and
 * "Dashboard" (/dashboard). The link matching the current route is highlighted
 * (accent text + an accent underline) using usePathname().
 *
 * Layout:
 *   - Desktop / tablet: icon + text label per link.
 *   - Mobile (<= ~400px): the wordmark text and the link labels collapse so the
 *     bar stays on one row; links become icon-only but keep an accessible name
 *     via aria-label + title.
 *
 * Accessibility / motion:
 *   - Every interactive target is >= 44px tall (h-11) for touch.
 *   - Visible focus rings (ring-accent) on every link.
 *   - No JS-driven reveal animation — only CSS color transitions — so it is
 *     inherently reduced-motion safe and never gets stuck at opacity:0.
 *
 * Drop <AppNav /> at the very top of any inner page that should carry global
 * navigation. It is intentionally NOT used on the landing page (/), which has
 * its own marketing header.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrainCircuit,
  LayoutDashboard,
  LogIn,
  LogOut,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient, getUserSafe } from "@/lib/supabase/client";

/** A single right-side nav destination. */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/generate", label: "New quiz", icon: Sparkles },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

/**
 * Is `href` the active route? True for an exact match, or when the current path
 * is nested under it (so /generate stays active on /generate/anything). We never
 * treat "/" as a prefix match here because none of the nav items point at root.
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * What the nav knows about the viewer's auth state.
 *   - "loading": we haven't asked Supabase yet (first paint) — render nothing
 *     in the account slot to avoid a flash of the wrong control.
 *   - "signed-out": show a "Sign in" link.
 *   - "signed-in": show the email + a "Sign out" button.
 */
type AccountState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; email: string | null };

export default function AppNav() {
  const pathname = usePathname() ?? "";

  // Account state is resolved client-side (this is a "use client" component).
  // We read the current user on mount and subscribe to auth changes so the nav
  // updates immediately on sign-in / sign-out without a page reload.
  const [account, setAccount] = useState<AccountState>({ status: "loading" });

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // getUserSafe swallows the "Invalid Refresh Token" throw from a stale cookie
    // (clears the dead session and returns null) so it never bubbles up as an
    // unhandled error / dev overlay — the nav just shows "signed-out".
    void getUserSafe(supabase).then((user) => {
      if (!active) return;
      setAccount(
        user
          ? { status: "signed-in", email: user.email ?? null }
          : { status: "signed-out" },
      );
    });

    // Keep the nav in sync with later auth events (sign-in/out in another tab,
    // token refresh, etc.). onAuthStateChange fires immediately with the current
    // session too, so this also covers the initial value.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAccount(
        session?.user
          ? { status: "signed-in", email: session.user.email ?? null }
          : { status: "signed-out" },
      );
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 border-b border-border">
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6"
      >
        {/* Wordmark — links home */}
        <Link
          href="/"
          aria-label="QuizForge home"
          className="group inline-flex h-11 items-center gap-2.5 rounded-xl pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--gradient-brand)] shadow-[0_8px_24px_-8px_var(--accent-glow)]">
            <BrainCircuit className="size-5 text-white" aria-hidden="true" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-foreground">
            QuizForge
          </span>
        </Link>

        {/* Right cluster: destinations + account control */}
        <div className="flex items-center gap-1 sm:gap-2">
        {/* Destinations */}
        <ul className="flex items-center gap-1 sm:gap-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  title={label}
                  className={cn(
                    "relative inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium sm:px-4",
                    "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                    active
                      ? "text-foreground"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-accent" : "text-current",
                    )}
                    aria-hidden="true"
                  />
                  {/* Label hides on the narrowest screens (icon-only on mobile). */}
                  <span className="hidden sm:inline">{label}</span>

                  {/* Active underline — a static element, not a reveal animation. */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent sm:inset-x-4"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

          {/* Account control — a thin divider, then sign-in / account state. */}
          <span
            aria-hidden="true"
            className="mx-1 h-6 w-px shrink-0 self-center bg-border sm:mx-1.5"
          />
          <AccountControl account={account} />
        </div>
      </nav>
    </header>
  );
}

/**
 * AccountControl — the right-most nav slot reflecting auth state.
 *
 *   - loading:    render an empty fixed-width spacer so the bar doesn't jump
 *                 (layout shift) once the real control appears.
 *   - signed-out: a "Sign in" link to /login.
 *   - signed-in:  a circular initial avatar + email (email hidden on mobile),
 *                 and a "Sign out" button that POSTs to /auth/signout.
 *
 * Sign-out is a real form POST (not a client call) so the server route can clear
 * the auth cookies and redirect. The route /auth/signout is owned by another
 * agent; this control is wired to it and works the moment that route exists.
 */
function AccountControl({ account }: { account: AccountState }) {
  if (account.status === "loading") {
    // Reserve roughly the width of the signed-in/out control to avoid a jump.
    return <span aria-hidden="true" className="h-11 w-11 sm:w-20" />;
  }

  if (account.status === "signed-out") {
    return (
      <Link
        href="/login"
        aria-label="Sign in"
        title="Sign in"
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium sm:px-4",
          "text-foreground-muted transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "hover:text-foreground hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        )}
      >
        <LogIn className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Sign in</span>
      </Link>
    );
  }

  // signed-in
  const initial = (account.email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {/* Initial avatar + email. The email is title-truncated and hidden on
          mobile so the bar stays on one row. */}
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--gradient-brand)] text-xs font-bold text-white"
        aria-hidden="true"
      >
        {initial}
      </span>
      <span
        className="hidden max-w-[12rem] truncate text-sm text-foreground-muted lg:inline"
        title={account.email ?? undefined}
      >
        {account.email}
      </span>

      {/* Sign out — a form POST to the server route that clears auth cookies. */}
      <form action="/auth/signout" method="post" className="contents">
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className={cn(
            "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium sm:px-3.5",
            "cursor-pointer text-foreground-muted transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "hover:text-foreground hover:bg-surface",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
          )}
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </form>
    </div>
  );
}
