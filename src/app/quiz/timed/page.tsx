"use client";

/**
 * /quiz/timed — Challenge (timed) mode.
 *
 * Reads the active Quiz from sessionStorage ("qf_active_quiz", the same key the
 * generate flow writes) and plays it under a countdown via <TimedQuiz/>. When the
 * attempt ends it:
 *   1. writes the result to sessionStorage "qf_active_result" as
 *      { quiz, answers, score } (the exact shape the results page reads),
 *   2. persists the attempt to history via saveAttempt(...) including
 *      durationSeconds, and
 *   3. routes to /quiz/active/results (shared results screen).
 *
 * The sessionStorage read uses useSyncExternalStore with a stable cached snapshot
 * so it survives React 19's set-state-in-effect rule and avoids hydration
 * mismatch — mirroring /quiz/active.
 */

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileQuestion } from "lucide-react";
import type { PlayConfig, Quiz, UserAnswer } from "@/lib/types";
import { Card } from "@/components/ui";
import AppNav from "@/components/AppNav";
import TimedQuiz from "@/components/TimedQuiz";
// Auth-aware save: Supabase when signed in, localStorage when signed out.
import { getCurrentUserId, saveAttempt } from "@/lib/store";

/** sessionStorage key holding the Quiz to play (set by the generate flow). */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";
/** sessionStorage key holding the finished result for the results page. */
const ACTIVE_RESULT_KEY = "qf_active_result";
/** sessionStorage key holding the PlayConfig (mode/timed/timer) for this attempt. */
const PLAY_CONFIG_KEY = "qf_play_config";
/** Fallback per-question budget (seconds) when no timer config is present. */
const DEFAULT_SECONDS_PER_QUESTION = 30;

/**
 * Shape stashed in sessionStorage for the results page to read.
 * `saved: true` tells the results page this attempt was ALREADY persisted here,
 * so it does not save it a second time.
 */
interface StoredResult {
  quiz: Quiz;
  answers: UserAnswer[];
  score: number;
  saved?: boolean;
}

/**
 * The generate flow may attach the DB quiz id as `db_id` on the quiz object
 * (it rides along in sessionStorage). We read it so the attempt links to the
 * quiz row. This is a structural extension of Quiz, not a redefinition.
 */
function quizDbId(quiz: Quiz): string | null {
  const id = (quiz as Quiz & { db_id?: unknown }).db_id;
  return typeof id === "string" ? id : null;
}

/** No-op subscribe: sessionStorage is read once on mount and never changes
 *  underneath this page during its lifetime. */
function noopSubscribe(): () => void {
  return () => {};
}

// getSnapshot must return a STABLE reference across renders. Cache the parsed
// Quiz keyed by the raw string so re-renders return the same object until the
// stored raw value actually changes.
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

// Stable-snapshot cache for the PlayConfig, same pattern as the quiz reader so
// useSyncExternalStore gets an identity-stable value across re-renders.
let cachedConfigRaw: string | null = null;
let cachedConfig: PlayConfig | null = null;

/** Read the PlayConfig from sessionStorage. Returns null when absent/invalid —
 *  callers fall back to the default per-question budget. */
function readPlayConfig(): PlayConfig | null {
  try {
    const raw = sessionStorage.getItem(PLAY_CONFIG_KEY);
    if (raw === cachedConfigRaw) return cachedConfig;
    cachedConfigRaw = raw;
    if (!raw) {
      cachedConfig = null;
      return null;
    }
    cachedConfig = JSON.parse(raw) as PlayConfig;
    return cachedConfig;
  } catch {
    cachedConfig = null;
    return null;
  }
}

export default function TimedQuizPage() {
  const router = useRouter();

  // false during SSR/first paint, true after hydration — lets us tell "loading"
  // apart from "found nothing".
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
  // PlayConfig carries the timer the generate page picked. Absent on SSR and
  // when the user didn't go through the configured flow.
  const playConfig = useSyncExternalStore<PlayConfig | null>(
    noopSubscribe,
    readPlayConfig,
    () => null,
  );

  // Translate the timer config into TimedQuiz props. 'total' => one whole-quiz
  // budget; 'per_question' => budget × N (TimedQuiz's default behavior). With no
  // valid timer we fall back to the default per-question budget.
  const timer = playConfig?.timer;
  const totalSeconds =
    timer?.kind === "total" && timer.seconds > 0 ? timer.seconds : undefined;
  const secondsPerQuestion =
    timer?.kind === "per_question" && timer.seconds > 0
      ? timer.seconds
      : DEFAULT_SECONDS_PER_QUESTION;

  function handleComplete(
    answers: UserAnswer[],
    score: number,
    durationSeconds: number,
  ) {
    if (!quiz) return;

    // 1) Stash the result for the shared results page, flagged `saved: true` so
    //    the results page does NOT persist this same attempt a second time.
    const result: StoredResult = { quiz, answers, score, saved: true };
    try {
      sessionStorage.setItem(ACTIVE_RESULT_KEY, JSON.stringify(result));
    } catch {
      // If storage fails the results page will show its own empty state.
    }

    // 2) Persist the attempt (fire-and-forget, best-effort). When signed in it
    //    goes to Supabase (linked to the DB quiz via db_id); signed out it goes
    //    to localStorage. We do NOT await — navigation must not wait on the save.
    void (async () => {
      try {
        const userId = await getCurrentUserId();
        await saveAttempt(userId, {
          quiz,
          answers,
          score,
          total: quiz.questions.length,
          durationSeconds,
          quizId: quizDbId(quiz),
        });
      } catch {
        // Saving is non-critical; the user still sees their results.
      }
    })();

    // 3) Go to the shared results screen.
    router.push("/quiz/active/results");
  }

  // Loading until hydration completes and we've read sessionStorage.
  if (!mounted) {
    return (
      <>
        <AppNav />
        <main className="flex min-h-[60vh] items-center justify-center px-4">
          <p className="text-sm text-foreground-muted">Loading your quiz…</p>
        </main>
      </>
    );
  }

  // Empty state: no quiz in session.
  if (!quiz) {
    return (
      <>
        <AppNav />
        <main className="flex min-h-[60vh] items-center justify-center px-4 py-16">
          <Card
            padding="lg"
            className="flex max-w-md flex-col items-center gap-5 text-center"
          >
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
                Generate a new quiz from your study material to start a timed
                challenge.
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
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="min-h-[60vh] px-4 py-10 sm:py-16">
        {/* Hidden h1 so the page starts at h1 before the question <h2>s. */}
        <h1 className="sr-only">Timed quiz</h1>
        {/* `totalSeconds` (when set) takes precedence inside TimedQuiz; otherwise
            it uses secondsPerQuestion × N. */}
        <TimedQuiz
          quiz={quiz}
          totalSeconds={totalSeconds}
          secondsPerQuestion={secondsPerQuestion}
          onComplete={handleComplete}
        />
      </main>
    </>
  );
}
