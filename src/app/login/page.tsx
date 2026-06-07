"use client";

/**
 * /login — the sign-in / create-account screen.
 *
 * One screen, two modes toggled by a segmented control:
 *   - "Sign in"        -> supabase.auth.signInWithPassword
 *   - "Create account" -> supabase.auth.signUp
 * Plus a "Continue with Google" button (OAuth PKCE -> /auth/callback).
 *
 * Success detection (the important bit the parent agent asked about):
 *   - signInWithPassword always returns a session on success -> push /generate.
 *   - signUp returns EITHER:
 *       (a) data.session !== null  -> email confirmation is OFF, user is logged
 *           in immediately -> push /generate; OR
 *       (b) data.session === null  -> Supabase requires email confirmation. We
 *           do NOT navigate; we show a "check your email" confirmation state.
 *   - Google: signInWithOAuth redirects the browser to Google, which returns to
 *     /auth/callback (the route handler exchanges the code, then -> /generate).
 *     If Google is disabled in the Supabase dashboard the call errors; we catch
 *     it and show a friendly "Google sign-in isn't enabled yet" message instead
 *     of a raw error.
 *
 * Everything runs in the browser ("use client") and uses the browser Supabase
 * client (@/lib/supabase/client — sync, NOT awaited).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  BrainCircuit,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { Button, Card, Input } from "@/components/ui";
import { SegmentedControl } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

/** The two auth modes the segmented control switches between. */
type Mode = "signin" | "signup";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
];

/** Supabase's default minimum password length. */
const MIN_PASSWORD = 6;

/** Lightweight email shape check (the real check is server-side). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Google "G" mark — small inline SVG so the OAuth button reads as Google
// without pulling in an icon set that doesn't ship a Google glyph.
// ---------------------------------------------------------------------------
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Friendly error mapping — turn raw Supabase messages into plain English.
// ---------------------------------------------------------------------------
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password don't match. Check them and try again.";
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the link.";
  }
  if (m.includes("user already registered") || m.includes("already registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (m.includes("password should be at least")) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (
    m.includes("provider is not enabled") ||
    m.includes("unsupported provider") ||
    m.includes("validation_failed")
  ) {
    return "Google sign-in isn't enabled yet. Use email and password for now.";
  }
  return message || "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();

  // The browser Supabase client. useMemo so we reuse one instance across
  // renders rather than building a fresh client on every keystroke.
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Field-level validation messages (shown under each Input).
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();

  // Form-level status.
  const [formError, setFormError] = useState<string | undefined>();
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);

  // If the callback route bounced back with ?error=auth_callback, surface it.
  useEffect(() => {
    if (searchParams.get("error") === "auth_callback") {
      setFormError("We couldn't finish signing you in. Please try again.");
    }
  }, [searchParams]);

  const isSignup = mode === "signup";

  // When the user flips modes, clear transient state so messages from one mode
  // don't linger into the other.
  function switchMode(next: Mode) {
    setMode(next);
    setFormError(undefined);
    setEmailError(undefined);
    setPasswordError(undefined);
    setConfirmEmailSent(false);
  }

  /** Validate the two fields. Returns true when both are OK. */
  function validate(): boolean {
    let ok = true;
    setEmailError(undefined);
    setPasswordError(undefined);

    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      ok = false;
    }
    if (password.length < MIN_PASSWORD) {
      setPasswordError(`At least ${MIN_PASSWORD} characters.`);
      ok = false;
    }
    return ok;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    setConfirmEmailSent(false);

    if (!validate()) return;

    setSubmitting(true);
    try {
      if (isSignup) {
        // SIGN UP. emailRedirectTo points at our callback route so that IF
        // email confirmation is on, the link in the email returns here and the
        // route handler exchanges the code for a session.
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) {
          setFormError(friendlyAuthError(error.message));
          return;
        }

        if (data.session) {
          // Confirmation is OFF -> already logged in.
          router.push("/generate");
          router.refresh();
        } else {
          // Confirmation is ON -> show "check your email" state.
          setConfirmEmailSent(true);
        }
      } else {
        // SIGN IN. On success there is always a session.
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          setFormError(friendlyAuthError(error.message));
          return;
        }

        router.push("/generate");
        router.refresh();
      }
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setFormError(undefined);
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      // On success the browser is redirected to Google, so code below this only
      // runs when there's an error (e.g. provider disabled in the dashboard).
      if (error) {
        setFormError(friendlyAuthError(error.message));
        setGoogleLoading(false);
      }
    } catch {
      setFormError("Google sign-in isn't enabled yet. Use email and password for now.");
      setGoogleLoading(false);
    }
  }

  const busy = submitting || googleLoading;

  // Mount-triggered reveal (NOT whileInView — that gets stuck at opacity:0 on
  // first paint). Gated behind reduced motion.
  const reveal = reduceMotion
    ? { initial: false as const, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Ambient brand glow behind the card (decorative; CSS handles reduced
          motion by freezing the drift animation). */}
      <div
        aria-hidden="true"
        className="ambient-blob -top-24 left-1/2 size-[28rem] -translate-x-1/2 bg-accent/25"
      />
      <div
        aria-hidden="true"
        className="ambient-blob bottom-[-10rem] right-[-6rem] size-[24rem] bg-secondary/20"
      />

      <motion.div
        initial={reveal.initial}
        animate={reveal.animate}
        transition={"transition" in reveal ? reveal.transition : undefined}
        className="relative z-10 w-full max-w-md"
      >
        {/* Wordmark — links home */}
        <Link
          href="/"
          aria-label="QuizForge home"
          className="mx-auto mb-8 flex w-fit items-center gap-2.5 rounded-xl px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--gradient-brand)] shadow-[0_8px_24px_-8px_var(--accent-glow)]">
            <BrainCircuit className="size-5 text-white" aria-hidden="true" />
          </span>
          <span className="text-xl font-extrabold tracking-tight text-foreground">
            QuizForge
          </span>
        </Link>

        <Card variant="glass" padding="lg" className="shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)]">
          {/* Heading */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-sm text-foreground-muted">
              {isSignup
                ? "Start generating study quizzes in seconds."
                : "Sign in to pick up where you left off."}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="mb-6">
            <SegmentedControl<Mode>
              ariaLabel="Choose sign in or create account"
              options={MODE_OPTIONS}
              value={mode}
              onChange={(v) => switchMode(v)}
              fullWidth
            />
          </div>

          {/* Confirm-email success state (replaces the form after sign-up when
              email confirmation is required). */}
          {confirmEmailSent ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-5 py-6 text-center"
            >
              <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">Check your email</p>
                <p className="mt-1 text-sm text-foreground-muted">
                  We sent a confirmation link to{" "}
                  <span className="font-medium text-foreground">{email.trim()}</span>.
                  Click it to finish creating your account.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => switchMode("signin")}
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              {/* Form-level error banner */}
              {formError && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
                <Input
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={emailError}
                  leftIcon={<Mail className="size-4" />}
                  disabled={busy}
                  required
                />

                {/* Password with show/hide toggle. The Input primitive supports
                    a leftIcon; we layer the reveal button on the right with an
                    absolutely-positioned button and pad the input via className. */}
                <div className="relative">
                  <Input
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    placeholder={isSignup ? "At least 6 characters" : "Your password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={passwordError}
                    leftIcon={<Lock className="size-4" />}
                    className="pr-11"
                    disabled={busy}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={busy}
                    // 44px (size-11) hit area for touch, with the icon kept small.
                    // top offset accounts for the label + gap above the field so
                    // the toggle sits centered on the input row, not the label.
                    className="absolute right-1.5 top-[1.65rem] grid size-11 place-items-center rounded-lg text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  loading={submitting}
                  disabled={busy}
                  className="mt-1"
                >
                  {isSignup ? "Create account" : "Sign in"}
                </Button>
              </form>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Google OAuth */}
              <Button
                variant="secondary"
                fullWidth
                size="lg"
                onClick={handleGoogle}
                loading={googleLoading}
                disabled={busy}
                leftIcon={<GoogleIcon className="size-5" />}
              >
                Continue with Google
              </Button>

              {/* Mode hint at the bottom */}
              <p className="mt-6 text-center text-sm text-foreground-muted">
                {isSignup ? "Already have an account?" : "New to QuizForge?"}{" "}
                <button
                  type="button"
                  onClick={() => switchMode(isSignup ? "signin" : "signup")}
                  className="font-semibold text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:underline"
                >
                  {isSignup ? "Sign in" : "Create one"}
                </button>
              </p>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-foreground-muted">
          By continuing you agree to use QuizForge for studying. Be awesome.
        </p>
      </motion.div>
    </main>
  );
}

/**
 * Page export. LoginForm calls useSearchParams(), which forces the subtree up to
 * the nearest Suspense boundary to be client-rendered. Next.js FAILS the
 * production build for a static page that uses useSearchParams without a
 * Suspense boundary (see node_modules/next/dist/docs .../use-search-params.md),
 * so we wrap it here. The fallback is a minimal centered placeholder.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center px-4">
          <div
            className="size-8 animate-spin rounded-full border-2 border-border border-t-accent"
            role="status"
            aria-label="Loading"
          />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
