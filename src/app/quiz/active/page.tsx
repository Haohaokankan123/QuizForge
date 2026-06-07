"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileQuestion, Info } from "lucide-react";
import type { Quiz, UserAnswer } from "@/lib/types";
import { Card } from "@/components/ui";
import QuizPlayer from "@/components/QuizPlayer";

/** sessionStorage key holding the Quiz to play (set by the generate flow). */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";
/** sessionStorage key holding the finished result for the results page. */
const ACTIVE_RESULT_KEY = "qf_active_result";

/** Shape stashed in sessionStorage for the results page to read. */
interface StoredResult {
  quiz: Quiz;
  answers: UserAnswer[];
  score: number;
}

/** No-op subscribe: sessionStorage is read once on mount; it never changes
 *  underneath this page during its lifetime, so there's nothing to subscribe to. */
function noopSubscribe(): () => void {
  return () => {};
}

// getSnapshot must return a STABLE reference across renders (useSyncExternalStore
// compares snapshots by identity). We cache the parsed Quiz keyed by the raw
// string so re-renders return the same object until sessionStorage's raw value
// actually changes.
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

export default function ActiveQuizPage() {
  const router = useRouter();
  // Lets the user dismiss the "fewer questions than asked" notice.
  const [warningDismissed, setWarningDismissed] = useState(false);

  // `mounted` is false during SSR/first paint and true after hydration; this
  // lets us tell "still loading" apart from "found nothing". Reading
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

  function handleComplete(answers: UserAnswer[], score: number) {
    if (!quiz) return;
    const result: StoredResult = { quiz, answers, score };
    try {
      sessionStorage.setItem(ACTIVE_RESULT_KEY, JSON.stringify(result));
    } catch {
      // If storage fails the results page will show its own empty state.
    }
    router.push("/quiz/active/results");
  }

  // Loading state until hydration completes and we've read sessionStorage.
  if (!mounted) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-sm text-foreground-muted">Loading your quiz…</p>
      </main>
    );
  }

  // Empty state: no quiz in session.
  if (!quiz) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-16">
        <Card padding="lg" className="flex max-w-md flex-col items-center gap-5 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"
            aria-hidden="true"
          >
            <FileQuestion size={26} />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              No quiz to play
            </h1>
            <p className="text-sm text-foreground-muted">
              Your quiz session has expired or hasn&apos;t been created yet.
              Generate a new quiz from your study material to get started.
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
    );
  }

  return (
    <main className="min-h-dvh px-4 py-10 sm:py-16">
      {/* Visually-hidden page heading so the document starts at h1 before the
          question <h2>s in QuizPlayer (keeps heading order valid for SR users). */}
      <h1 className="sr-only">Take your quiz</h1>
      {/* Quality notice: shown when the AI made fewer good questions than asked. */}
      {quiz.warning && !warningDismissed && (
        <div className="mx-auto mb-6 flex max-w-2xl items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
          <Info className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 text-sm text-foreground">{quiz.warning}</p>
          <button
            type="button"
            onClick={() => setWarningDismissed(true)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Dismiss notice"
          >
            Got it
          </button>
        </div>
      )}
      <QuizPlayer quiz={quiz} onComplete={handleComplete} />
    </main>
  );
}
