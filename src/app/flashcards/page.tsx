"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import type { Quiz } from "@/lib/types";
import { Card } from "@/components/ui";
import AppNav from "@/components/AppNav";
import AuthGuard from "@/components/AuthGuard";
import FlashcardDeck from "@/components/FlashcardDeck";

/** sessionStorage key holding the Quiz (set by the generate / quiz flow). */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";

/** No-op subscribe: sessionStorage is read once on mount; it never changes
 *  underneath this page during its lifetime, so there's nothing to subscribe to. */
function noopSubscribe(): () => void {
  return () => {};
}

// getSnapshot must return a STABLE reference across renders (useSyncExternalStore
// compares snapshots by identity). Cache the parsed Quiz keyed by the raw string
// so re-renders return the same object until sessionStorage's raw value changes.
let cachedRaw: string | null = null;
let cachedQuiz: Quiz | null = null;

function readActiveQuiz(): Quiz | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_QUIZ_KEY);
    if (raw === cachedRaw) return cachedQuiz;
    cachedRaw = raw;
    if (!raw) {
      cachedQuiz = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Quiz;
    cachedQuiz = parsed?.questions?.length ? parsed : null;
    return cachedQuiz;
  } catch {
    cachedQuiz = null;
    return null;
  }
}

export default function FlashcardsPage() {
  // `mounted` is false during SSR/first paint and true after hydration; this
  // lets us tell "still loading" apart from "found nothing", and reading
  // sessionStorage via useSyncExternalStore takes the snapshot after hydration,
  // avoiding both a hydration mismatch and the React 19 set-state-in-effect rule.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const quiz = useSyncExternalStore<Quiz | null>(
    noopSubscribe,
    readActiveQuiz,
    () => null,
  );

  return (
    <>
      <AppNav />
      <AuthGuard>

      {!mounted ? (
        <main className="flex min-h-[60dvh] items-center justify-center px-4">
          <p className="text-sm text-foreground-muted">Loading your flashcards…</p>
        </main>
      ) : !quiz ? (
        <main className="flex min-h-[60dvh] items-center justify-center px-4 py-16">
          <Card padding="lg" className="flex max-w-md flex-col items-center gap-5 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"
              aria-hidden="true"
            >
              <Layers size={26} />
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                No flashcards yet
              </h1>
              <p className="text-sm text-foreground-muted">
                Generate a quiz from your study material and study it as a deck of
                flashcards here.
              </p>
            </div>
            <Link
              href="/generate"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-7 text-base font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              Create a quiz
            </Link>
          </Card>
        </main>
      ) : (
        <main className="min-h-[60dvh] px-4 py-10 sm:py-14">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <header className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
                <Layers size={14} aria-hidden="true" />
                Flashcards
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {quiz.title}
              </h1>
            </header>
            <FlashcardDeck quiz={quiz} />
          </div>
        </main>
      )}
      </AuthGuard>
    </>
  );
}
