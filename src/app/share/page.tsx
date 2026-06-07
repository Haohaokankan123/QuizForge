"use client";

/**
 * Public shared-quiz landing page: /share?q=<encoded quiz>
 *
 * A recipient opens a share link, we decode the quiz straight out of the URL
 * (stateless — see src/lib/share.ts), and offer two ways in:
 *   - "Take this quiz"  -> stash the quiz in sessionStorage (qf_active_quiz) and
 *                          route to /quiz/active (the normal player flow).
 *   - "Flashcards"      -> same stash, route to /flashcards.
 *
 * This page is PUBLIC (no login) and is meant for people who don't have the app
 * yet, so it deliberately does NOT render the inner AppNav. It keeps a single
 * QuizForge wordmark linking home for orientation/branding.
 *
 * useSearchParams() forces a client render and must sit inside a <Suspense>
 * boundary in the App Router, so the param-reading logic lives in a child
 * component (ShareContent) that the default export wraps in <Suspense>.
 */

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BrainCircuit, Layers, LinkIcon, Play } from "lucide-react";
import type { Quiz } from "@/lib/types";
import { Badge, Button, Card } from "@/components/ui";
import { decodeQuizFromParam } from "@/lib/share";

/** sessionStorage key the active-quiz player + flashcards flow read from. */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";

/** Wordmark linking home — shared by every state of this page. */
function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="QuizForge home"
      className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--gradient-brand)] shadow-[0_8px_24px_-8px_var(--accent-glow)]">
        <BrainCircuit className="size-5 text-white" aria-hidden="true" />
      </span>
      <span className="text-lg font-extrabold tracking-tight text-foreground">
        QuizForge
      </span>
    </Link>
  );
}

/** Reads ?q=, decodes the quiz, and renders the appropriate state. */
function ShareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Decode on every render — cheap, pure, and avoids stale state if the param
  // changes. Returns null for missing/invalid/old links.
  const quiz: Quiz | null = decodeQuizFromParam(searchParams.get("q"));

  /** Stash the shared quiz and route to the given flow. */
  function startWith(path: string) {
    if (!quiz) return;
    try {
      sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(quiz));
    } catch {
      // If storage is unavailable the target page shows its own empty state.
    }
    router.push(path);
  }

  // --- Invalid / missing link ----------------------------------------------
  if (!quiz) {
    return (
      <main className="flex min-h-dvh flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">
          <Wordmark />
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <Card
            padding="lg"
            className="flex max-w-md flex-col items-center gap-5 text-center"
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive"
              aria-hidden="true"
            >
              <LinkIcon size={26} />
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                This share link isn&apos;t valid
              </h1>
              <p className="text-sm text-foreground-muted">
                The link may be incomplete or out of date. Ask whoever shared it
                to send it again — or create your own quiz from study material.
              </p>
            </div>
            <Link
              href="/generate"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-7 text-base font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              Create a quiz
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  // --- Valid shared quiz ----------------------------------------------------
  const count = quiz.questions.length;

  return (
    <main className="flex min-h-dvh flex-col px-4 py-6">
      <div className="mx-auto w-full max-w-2xl">
        <Wordmark />
      </div>

      <div className="flex flex-1 items-center justify-center py-10 sm:py-16">
        <Card
          variant="glass"
          padding="lg"
          className="relative flex w-full max-w-lg flex-col items-center gap-6 overflow-hidden text-center"
        >
          {/* Soft ambient glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--accent-glow),transparent_70%)] blur-2xl"
          />

          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent">
            <LinkIcon size={13} aria-hidden="true" />
            Shared with you
          </span>

          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            {quiz.title}
          </h1>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="secondary" size="sm">
              {quiz.difficulty}
            </Badge>
            <Badge variant="neutral" size="sm">
              {count} question{count === 1 ? "" : "s"}
            </Badge>
          </div>

          <p className="max-w-sm text-sm text-foreground-muted">
            Test yourself with this quiz, or flip through it as flashcards. No
            account needed.
          </p>

          <div className="mt-1 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              onClick={() => startWith("/quiz/active")}
              size="lg"
              fullWidth
              leftIcon={<Play size={18} aria-hidden="true" />}
              className="sm:w-auto"
            >
              Take this quiz
            </Button>
            <Button
              onClick={() => startWith("/flashcards")}
              variant="secondary"
              size="lg"
              fullWidth
              leftIcon={<Layers size={18} aria-hidden="true" />}
              className="sm:w-auto"
            >
              Flashcards
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

/** Minimal fallback shown while the client renders search params. */
function ShareFallback() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <p className="text-sm text-foreground-muted">Loading shared quiz…</p>
    </main>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<ShareFallback />}>
      <ShareContent />
    </Suspense>
  );
}
