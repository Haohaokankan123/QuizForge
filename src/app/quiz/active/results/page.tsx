"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  FileDown,
  FileQuestion,
  Layers,
  Quote,
  RotateCcw,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import type { Quiz, UserAnswer } from "@/lib/types";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { buildShareUrl } from "@/lib/share";
import { exportQuizToPdf } from "@/lib/pdf";
// Auth-aware save: Supabase when signed in, localStorage when signed out.
import { getCurrentUserId, saveAttempt } from "@/lib/store";

/** sessionStorage key holding the Quiz to play. */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";
/** sessionStorage key holding the finished result. */
const ACTIVE_RESULT_KEY = "qf_active_result";

interface StoredResult {
  quiz: Quiz;
  answers: UserAnswer[];
  score: number;
  /** Set by the timed page when it already persisted this attempt, so we don't
   *  save it a second time here. Absent for the non-timed flow (we save it). */
  saved?: boolean;
}

/**
 * The generate flow attaches the DB quiz id as `db_id` on the quiz (it rides
 * along in sessionStorage). We read it so the saved attempt links to the quiz.
 */
function quizDbId(quiz: Quiz): string | null {
  const id = (quiz as Quiz & { db_id?: unknown }).db_id;
  return typeof id === "string" ? id : null;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** No-op subscribe: the result is read once on mount; it doesn't change here. */
function noopSubscribe(): () => void {
  return () => {};
}

// getSnapshot must return a stable reference; cache the parsed result keyed by
// the raw string so re-renders return the same object until it actually changes.
let cachedRaw: string | null = null;
let cachedResult: StoredResult | null = null;

function readResult(): StoredResult | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_RESULT_KEY);
    if (raw === cachedRaw) return cachedResult;
    cachedRaw = raw;
    if (!raw) {
      cachedResult = null;
      return null;
    }
    const parsed = JSON.parse(raw) as StoredResult;
    cachedResult = parsed?.quiz?.questions?.length ? parsed : null;
    return cachedResult;
  } catch {
    cachedResult = null;
    return null;
  }
}

export default function ResultsPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  // `mounted` distinguishes "loading" (pre-hydration) from "nothing found".
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const result = useSyncExternalStore<StoredResult | null>(
    noopSubscribe,
    readResult,
    () => null,
  );

  const total = result ? result.quiz.questions.length : 0;
  const score = result ? result.score : 0;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  // Map answers by questionId for fast per-question lookup in the review.
  const answerByQ = useMemo(() => {
    const map = new Map<string, UserAnswer>();
    if (result) {
      for (const a of result.answers) map.set(a.questionId, a);
    }
    return map;
  }, [result]);

  // Persist this attempt EXACTLY ONCE (best-effort), for the non-timed flow.
  // The timed page already saves its attempt and flags the stored result with
  // `saved: true`, so we skip those to avoid a duplicate. Signed in -> Supabase
  // (linked to the DB quiz via db_id); signed out -> localStorage. We guard with
  // a ref so React's mount/StrictMode re-runs never double-save the same result.
  const savedRef = useRef(false);
  useEffect(() => {
    if (!result || result.saved || savedRef.current) return;
    savedRef.current = true;

    void (async () => {
      try {
        const userId = await getCurrentUserId();
        await saveAttempt(userId, {
          quiz: result.quiz,
          answers: result.answers,
          score: result.score,
          total: result.quiz.questions.length,
          quizId: quizDbId(result.quiz),
        });
        // Mark the stored result as saved so a refresh/back-forward doesn't
        // re-save the same attempt on a fresh mount.
        try {
          sessionStorage.setItem(
            ACTIVE_RESULT_KEY,
            JSON.stringify({ ...result, saved: true }),
          );
        } catch {
          // Non-critical: worst case a manual reload could re-save once.
        }
      } catch {
        // Saving is non-critical; the user still sees their results.
      }
    })();
  }, [result]);

  function handleRetry() {
    if (!result) return;
    try {
      // Re-arm the active quiz and clear the stale result so the player starts fresh.
      sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(result.quiz));
      sessionStorage.removeItem(ACTIVE_RESULT_KEY);
    } catch {
      // best effort
    }
    router.push("/quiz/active");
  }

  // Send the user to flashcard study mode for this same quiz.
  function handleFlashcards() {
    if (!result) return;
    try {
      sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(result.quiz));
    } catch {
      // best effort
    }
    router.push("/flashcards");
  }

  // "idle" | "copied" | "error" — drives the Share button label/feedback.
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">("idle");

  // Build a self-contained share link (the whole quiz rides in the URL) and copy
  // it to the clipboard. No backend needed — anyone with the link can take it.
  async function handleShare() {
    if (!result) return;
    try {
      const url = buildShareUrl(result.quiz, window.location.origin);
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 2000);
    } catch {
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2500);
    }
  }

  // "idle" | "working" | "error" — disables the PDF button while jsPDF builds
  // the file, and surfaces a brief failure message so a silent no-download isn't
  // mistaken for a broken button.
  const [pdfState, setPdfState] = useState<"idle" | "working" | "error">(
    "idle",
  );

  // Generate and download a printable PDF of this quiz (with answer key).
  async function handleDownloadPdf() {
    if (!result) return;
    setPdfState("working");
    try {
      await exportQuizToPdf(result.quiz, { includeAnswers: true });
      setPdfState("idle");
    } catch {
      // Show a short-lived error label, then reset (mirrors the Share feedback).
      setPdfState("error");
      setTimeout(() => setPdfState("idle"), 2500);
    }
  }

  if (!mounted) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-sm text-foreground-muted">Loading your results…</p>
      </main>
    );
  }

  if (!result) {
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
              No results to show
            </h1>
            <p className="text-sm text-foreground-muted">
              Finish a quiz first and your score plus a full answer review will
              appear here.
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

  const { quiz } = result;

  // Friendly headline keyed to the percentage.
  const headline =
    pct >= 90
      ? "Outstanding!"
      : pct >= 70
        ? "Great work!"
        : pct >= 50
          ? "Nice effort!"
          : "Keep going!";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:py-16">
      {/* Score hero */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE }}
      >
        <Card
          variant="glass"
          padding="lg"
          className="relative flex flex-col items-center gap-4 overflow-hidden text-center"
        >
          {/* Soft ambient glow behind the score */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--accent-glow),transparent_70%)] blur-2xl"
          />

          <motion.span
            className="inline-flex items-center gap-1.5 text-xs font-medium text-warning"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduceMotion ? { duration: 0 } : { delay: 0.15, duration: 0.4, ease: EASE }
            }
          >
            <Sparkles size={14} aria-hidden="true" />
            {headline}
          </motion.span>

          <motion.div
            className="relative flex items-baseline justify-center gap-2"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { delay: 0.1, type: "spring", damping: 18, stiffness: 120 }
            }
          >
            <span className="text-6xl font-extrabold tabular-nums text-warning sm:text-7xl">
              {score}
            </span>
            <span className="text-2xl font-semibold tabular-nums text-foreground-muted">
              / {total}
            </span>
          </motion.div>

          <p className="text-sm font-medium text-foreground-muted tabular-nums">
            {pct}% correct
          </p>

          <h1 className="mt-1 text-lg font-semibold text-foreground">
            {quiz.title}
          </h1>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={handleRetry} variant="secondary" leftIcon={<RotateCcw size={18} aria-hidden="true" />}>
              Retry quiz
            </Button>
            <Link
              href="/generate"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              New quiz
            </Link>
          </div>

          {/* Secondary actions: study, share, export */}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={handleFlashcards}
              variant="ghost"
              size="sm"
              leftIcon={<Layers size={16} aria-hidden="true" />}
            >
              Flashcards
            </Button>
            <Button
              onClick={handleShare}
              variant="ghost"
              size="sm"
              leftIcon={<Share2 size={16} aria-hidden="true" />}
            >
              {shareState === "copied"
                ? "Link copied!"
                : shareState === "error"
                  ? "Copy failed"
                  : "Share"}
            </Button>
            <Button
              onClick={handleDownloadPdf}
              variant="ghost"
              size="sm"
              loading={pdfState === "working"}
              leftIcon={<FileDown size={16} aria-hidden="true" />}
            >
              {pdfState === "error" ? "Export failed" : "Download PDF"}
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* Per-question review */}
      <section className="flex flex-col gap-4" aria-label="Answer review">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Review
        </h2>

        {quiz.questions.map((q, i) => {
          const ua = answerByQ.get(q.id);
          const isCorrect = Boolean(ua?.correct);
          const given = ua?.given ?? "";

          return (
            <motion.div
              key={q.id}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.4, ease: EASE, delay: Math.min(i, 6) * 0.03 }
              }
            >
              <Card
                padding="lg"
                className={cn(
                  "flex flex-col gap-4 border-l-4",
                  isCorrect ? "border-l-success" : "border-l-destructive",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      isCorrect
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                    aria-hidden="true"
                  >
                    {isCorrect ? <Check size={15} /> : <X size={15} />}
                  </span>
                  {/* Correctness is otherwise conveyed only by color + icon;
                      this hidden text makes it available to screen readers. */}
                  <span className="sr-only">
                    {isCorrect ? "Correct." : "Incorrect."}
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-foreground-muted tabular-nums">
                      Question {i + 1}
                    </span>
                    <p className="font-semibold leading-snug text-foreground">
                      {q.prompt}
                    </p>
                  </div>
                </div>

                {/* Answers */}
                <div className="flex flex-col gap-2 pl-9">
                  <AnswerRow
                    label="Your answer"
                    value={given.length > 0 ? given : "(no answer)"}
                    tone={isCorrect ? "success" : "danger"}
                  />
                  {!isCorrect && (
                    <AnswerRow
                      label="Correct answer"
                      value={q.answer}
                      tone="success"
                    />
                  )}
                </div>

                {/* Explanation */}
                {q.explanation && (
                  <div className="pl-9">
                    <p className="text-sm leading-relaxed text-foreground-muted">
                      {q.explanation}
                    </p>
                  </div>
                )}

                {/* Source quote — the explain-from-source feature */}
                {q.source_quote && (
                  <div className="ml-9 rounded-2xl border border-border bg-bg-base/60 p-4">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
                      <Quote size={13} aria-hidden="true" />
                      From your material
                    </div>
                    <blockquote className="text-sm italic leading-relaxed text-foreground">
                      “{q.source_quote}”
                    </blockquote>
                  </div>
                )}
              </Card>
            </motion.div>
          );
        })}
      </section>

      {/* Footer actions (repeat for convenience after a long review) */}
      <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
        <Button onClick={handleRetry} variant="secondary" leftIcon={<RotateCcw size={18} aria-hidden="true" />}>
          Retry quiz
        </Button>
        <Link
          href="/generate"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          New quiz
        </Link>
      </div>
    </main>
  );
}

interface AnswerRowProps {
  label: string;
  value: string;
  tone: "success" | "danger";
}

/** A labeled answer line with a colored badge (used for given/correct answers). */
function AnswerRow({ label, value, tone }: AnswerRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={tone} size="sm">
        {label}
      </Badge>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
