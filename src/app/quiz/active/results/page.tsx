"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Check,
  FileDown,
  FileQuestion,
  Layers,
  Quote,
  RotateCcw,
  Share2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import type { Quiz, Question, UserAnswer } from "@/lib/types";
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

  // --- Retry my mistakes ----------------------------------------------------
  // The questions the user got wrong (or skipped). We re-quiz the SAME concepts
  // with NEW questions so retrying isn't just memorising the same items.
  const missedQuestions = useMemo<Question[]>(() => {
    if (!result) return [];
    return result.quiz.questions.filter((q) => !answerByQ.get(q.id)?.correct);
  }, [result, answerByQ]);

  // "idle" | "working" | "error" — drives the "Retry my mistakes" button. The
  // request can take a while (it hits the same AI engine /api/generate uses), so
  // we show a spinner and surface failures inline rather than failing silently.
  const [retryState, setRetryState] = useState<"idle" | "working" | "error">(
    "idle",
  );

  // Build a focused re-quiz of the missed concepts and route into the player.
  // We reuse the existing /api/generate contract: sourceType 'ai' +
  // useOwnKnowledge so the model writes NEW questions on the same underlying
  // ideas (described in `topic`) rather than copying the missed ones verbatim.
  async function handleRetryMistakes() {
    if (!result || missedQuestions.length === 0) return;
    setRetryState("working");

    // Describe exactly what to re-test: the prompt + correct answer of each miss.
    const conceptList = missedQuestions
      .map((q, i) => `${i + 1}. Q: ${q.prompt} (Answer: ${q.answer})`)
      .join("\n");

    // At least 3 questions so a single miss still yields a worthwhile re-quiz.
    const count = Math.max(3, missedQuestions.length);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Keep the SAME types + difficulty as the original quiz so the retry
          // matches the user's chosen format.
          content: "",
          types: Array.from(new Set(result.quiz.questions.map((q) => q.type))),
          difficulty: result.quiz.difficulty,
          count,
          sourceType: "ai",
          useOwnKnowledge: true,
          topic: `Re-test these specific concepts the student got wrong:\n${conceptList}`,
          focus:
            "Make NEW questions testing the same underlying concepts as these missed ones, do not copy them verbatim.",
        }),
      });

      // Read the body once; it's either a Quiz or { error }.
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setRetryState("error");
        setTimeout(() => setRetryState("idle"), 2500);
        return;
      }

      // Success: stash the focused re-quiz, clear the stale result, play it.
      const quiz = data as Quiz;
      try {
        sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(quiz));
        sessionStorage.removeItem(ACTIVE_RESULT_KEY);
      } catch {
        // best effort
      }
      router.push("/quiz/active");
    } catch {
      setRetryState("error");
      setTimeout(() => setRetryState("idle"), 2500);
    }
  }

  // --- Study guide ----------------------------------------------------------
  // "idle" | "working" | "ready" | "error" — drives the "Study guide" button and
  // whether the rendered guide Card is shown.
  const [guideState, setGuideState] = useState<
    "idle" | "working" | "ready" | "error"
  >("idle");
  // The returned Markdown, rendered below once `guideState === "ready"`.
  const [guideMarkdown, setGuideMarkdown] = useState<string>("");
  // A human-readable failure reason, shown when guideState === "error".
  const [guideError, setGuideError] = useState<string>("");

  // Request a study guide from the quiz itself. The results page doesn't keep the
  // raw source material, so we reconstruct study material from each question's
  // prompt + answer + explanation + source quote and send THAT as the content.
  async function handleStudyGuide() {
    if (!result) return;

    // If we already built one this session, just reveal it again.
    if (guideState === "ready" && guideMarkdown) {
      setGuideState("ready");
      return;
    }

    setGuideState("working");
    setGuideError("");

    const material = result.quiz.questions
      .map((q, i) => {
        const parts = [`${i + 1}. ${q.prompt}`, `Answer: ${q.answer}`];
        if (q.explanation) parts.push(`Why: ${q.explanation}`);
        if (q.source_quote) parts.push(`Source: "${q.source_quote}"`);
        return parts.join("\n");
      })
      .join("\n\n");

    try {
      const res = await fetch("/api/study-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: material }),
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        // Surface the route's friendly { error } (e.g. "Please sign in…").
        const msg =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Couldn't make a study guide. Try again.";
        setGuideError(msg);
        setGuideState("error");
        setTimeout(() => setGuideState("idle"), 3000);
        return;
      }

      // The route returns Markdown under { guide } (its documented contract).
      // Keep { markdown } / bare-string as defensive fallbacks.
      const md =
        data && typeof data === "object" && data !== null
          ? String(
              (data as { guide?: unknown; markdown?: unknown }).guide ??
                (data as { markdown?: unknown }).markdown ??
                "",
            )
          : typeof data === "string"
            ? data
            : "";

      if (!md.trim()) {
        setGuideError("The study guide came back empty. Try again.");
        setGuideState("error");
        setTimeout(() => setGuideState("idle"), 3000);
        return;
      }

      setGuideMarkdown(md);
      setGuideState("ready");
    } catch {
      setGuideError("Couldn't reach the server. Check your connection and try again.");
      setGuideState("error");
      setTimeout(() => setGuideState("idle"), 3000);
    }
  }

  // Print just the study guide (browser print dialog -> "Save as PDF"). The quiz
  // PDF export (exportQuizToPdf) is built from a Quiz, not free Markdown, so for
  // the guide we use a self-contained print window instead.
  function handlePrintGuide() {
    if (!guideMarkdown.trim()) return;
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    const title = `${result?.quiz.title ?? "Study guide"} — Study guide`;
    // Render the Markdown to safe, escaped HTML for the print document.
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
        title,
      )}</title><style>` +
        "body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:42rem;margin:2.5rem auto;padding:0 1.25rem;color:#111;line-height:1.6}" +
        "h1{font-size:1.6rem}h2{font-size:1.25rem;margin-top:1.6rem}h3{font-size:1.05rem;margin-top:1.2rem}" +
        "ul{padding-left:1.25rem}li{margin:.25rem 0}p{margin:.6rem 0}" +
        "</style></head><body>" +
        markdownToHtml(guideMarkdown) +
        "</body></html>",
    );
    win.document.close();
    win.focus();
    win.print();
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

          {/* Retry just the missed concepts — only shown when something was
              wrong. Builds a fresh AI re-quiz of those ideas and plays it. */}
          {missedQuestions.length > 0 && (
            <div className="mt-1 flex w-full flex-col items-center gap-1">
              <Button
                onClick={handleRetryMistakes}
                loading={retryState === "working"}
                leftIcon={<Target size={18} aria-hidden="true" />}
              >
                {retryState === "working"
                  ? "Building re-quiz…"
                  : `Retry my mistakes (${missedQuestions.length})`}
              </Button>
              {retryState === "error" && (
                <p className="text-xs text-destructive">
                  Couldn&apos;t build a re-quiz. Please try again.
                </p>
              )}
            </div>
          )}

          {/* Secondary actions: study, guide, share, export */}
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
              onClick={handleStudyGuide}
              variant="ghost"
              size="sm"
              loading={guideState === "working"}
              leftIcon={<BookOpen size={16} aria-hidden="true" />}
            >
              {guideState === "error" ? "Guide failed" : "Study guide"}
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
          {/* Study-guide failure reason (surfaces the route's friendly message). */}
          {guideState === "error" && guideError && (
            <p role="alert" className="text-sm text-destructive">
              {guideError}
            </p>
          )}
        </Card>
      </motion.div>

      {/* Study guide — rendered once the AI returns one. Self-contained: a
          Markdown render plus a print-to-PDF action. */}
      {guideState === "ready" && guideMarkdown && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: EASE }}
        >
          <Card padding="lg" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent">
                <BookOpen size={15} aria-hidden="true" />
                Study guide
              </h2>
              <Button
                onClick={handlePrintGuide}
                variant="ghost"
                size="sm"
                leftIcon={<FileDown size={16} aria-hidden="true" />}
              >
                Download PDF
              </Button>
            </div>
            <Markdown source={guideMarkdown} />
          </Card>
        </motion.div>
      )}

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

// --- Minimal Markdown rendering ---------------------------------------------
// No markdown library is bundled, so we render a useful subset of the Markdown
// the AI study guide returns: ATX headings (#, ##, ###), unordered lists
// (- / *), and paragraphs. Inline **bold** is supported within a line. This is
// intentionally small — full CommonMark is out of scope for a study guide.

/** Escape HTML-special characters so user/AI text can't inject markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Apply inline **bold** to an already-escaped line. */
function inlineBold(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Convert a small Markdown subset to an HTML string (used for the print window).
 * Input is escaped first, so the result is safe to inject.
 */
function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);

    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineBold(escapeHtml(heading[2]))}</h${level}>`);
    } else if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineBold(escapeHtml(bullet[1]))}</li>`);
    } else if (line.trim().length === 0) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inlineBold(escapeHtml(line))}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

/**
 * Render the same Markdown subset as React nodes for on-page display. Mirrors
 * markdownToHtml's parsing so the screen and the printed PDF stay consistent.
 */
function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let listItems: string[] = [];
  let key = 0;

  /** Render an inline string with **bold** spans into React nodes. */
  const renderInline = (text: string): ReactNode[] =>
    text.split(/(\*\*.+?\*\*)/g).map((part, i) =>
      /^\*\*.+\*\*$/.test(part) ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground-muted">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);

    if (heading) {
      flushList();
      const level = heading[1].length;
      const text = renderInline(heading[2]);
      if (level === 1) {
        blocks.push(
          <h3 key={`h-${key++}`} className="text-base font-semibold text-foreground">
            {text}
          </h3>,
        );
      } else if (level === 2) {
        blocks.push(
          <h4 key={`h-${key++}`} className="text-sm font-semibold text-foreground">
            {text}
          </h4>,
        );
      } else {
        blocks.push(
          <h5 key={`h-${key++}`} className="text-sm font-medium text-foreground">
            {text}
          </h5>,
        );
      }
    } else if (bullet) {
      listItems.push(bullet[1]);
    } else if (line.trim().length === 0) {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p-${key++}`} className="text-sm leading-relaxed text-foreground-muted">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
