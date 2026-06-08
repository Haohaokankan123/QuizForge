"use client";

/**
 * TimedQuiz — a "challenge mode" wrapper around {@link QuizPlayer}.
 *
 * It does NOT re-implement question rendering or grading. Instead it:
 *   1. Renders a sticky countdown bar/clock at the top (tabular-nums) that turns
 *      warning -> destructive as time runs low, with an optional reduced-motion
 *      pulse on the final seconds.
 *   2. Renders the real <QuizPlayer/> underneath, so all rendering, keyboard nav
 *      and per-type grading stay exactly as in normal mode.
 *   3. Tracks total elapsed seconds from a mount timestamp (captured in a ref via
 *      useEffect — never Date.now() at module top level) and forwards
 *      durationSeconds to onComplete when the player finishes naturally.
 *   4. If the single total countdown (secondsPerQuestion * questions.length)
 *      reaches 0 before the player finishes, it surfaces a "Time's up" overlay.
 *      QuizPlayer owns its own question state and only reports answers at the very
 *      end, so on timeout we don't fight it: the overlay's "Finish" completes the
 *      attempt with the questions marked unanswered (given "", correct false),
 *      i.e. whatever wasn't confirmed in time scores 0.
 *   5. Offers an Exit affordance in the header. It opens a confirm dialog (same
 *      Card-overlay pattern as the time-up screen) with two choices:
 *        - "Submit what I have": finishes the attempt now. Because QuizPlayer only
 *          reports at the end, anything unconfirmed is scored as missed — exactly
 *          like the time-up path.
 *        - "Discard": leaves the attempt and navigates to /generate.
 *
 * Props:
 *   - quiz: the Quiz to play.
 *   - secondsPerQuestion: budget per question; total = this * questions.length.
 *     Defaults to 30. Ignored when `totalSeconds` is provided.
 *   - totalSeconds: an explicit total budget for the whole quiz. When provided it
 *     is used directly and overrides the secondsPerQuestion * N calculation.
 *   - onComplete(answers, score, durationSeconds): called once, either when the
 *     player finishes or when the user clicks Finish on the time-up overlay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { AlarmClock, Flag, LogOut, TimerReset, X } from "lucide-react";
import type { Quiz, UserAnswer } from "@/lib/types";
import { Button, Card, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import QuizPlayer from "@/components/QuizPlayer";

/** Props for {@link TimedQuiz}. */
export interface TimedQuizProps {
  quiz: Quiz;
  /** Seconds allotted per question; total budget = this * questions.length. @default 30 */
  secondsPerQuestion?: number;
  /**
   * Explicit total budget (seconds) for the whole quiz. When set, it is used
   * directly and takes precedence over `secondsPerQuestion`. When omitted, the
   * budget falls back to `secondsPerQuestion * questions.length`.
   */
  totalSeconds?: number;
  /**
   * Called once when the attempt ends — either the player finished all
   * questions, or time expired and the user clicked Finish.
   * `durationSeconds` is the wall-clock time the attempt actually took.
   */
  onComplete: (
    answers: UserAnswer[],
    score: number,
    durationSeconds: number,
  ) => void;
}

/** Format whole seconds as M:SS (e.g. 75 -> "1:15"). */
function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function TimedQuiz({
  quiz,
  secondsPerQuestion = 30,
  totalSeconds,
  onComplete,
}: TimedQuizProps) {
  const reduceMotion = useReducedMotion();
  const router = useRouter();

  // Total budget for the whole quiz. If an explicit `totalSeconds` was passed,
  // use it directly; otherwise fall back to secondsPerQuestion * N. Guard against
  // a 0-question quiz (or a non-positive override) so the budget is always >= 1.
  const budgetSeconds = useMemo(
    () =>
      totalSeconds != null
        ? Math.max(1, totalSeconds)
        : Math.max(1, secondsPerQuestion) * Math.max(1, quiz.questions.length),
    [totalSeconds, secondsPerQuestion, quiz.questions.length],
  );

  // Remaining seconds shown to the user. Starts at the full budget.
  const [remaining, setRemaining] = useState(budgetSeconds);
  // True once the budget hits 0 and the player hasn't finished yet.
  const [timeUp, setTimeUp] = useState(false);
  // True while the Exit confirmation dialog is open.
  const [exitOpen, setExitOpen] = useState(false);

  // Mount timestamp (ms). Captured in an effect so it is browser-only and never
  // read at module top level. Used to compute the true elapsed duration.
  const startedAtRef = useRef<number | null>(null);
  // Ensures onComplete fires at most once (player-finish vs time-up race).
  const finishedRef = useRef(false);
  // Dialog containers, focused when their overlay opens (a11y: move focus into
  // the modal so keyboard/SR users land on it, not the inert quiz behind).
  const timeUpRef = useRef<HTMLDivElement | null>(null);
  const exitDialogRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the time-up overlay when it appears.
  useEffect(() => {
    if (timeUp) timeUpRef.current?.focus();
  }, [timeUp]);

  // Move focus into the exit dialog on open; close it on Escape.
  useEffect(() => {
    if (!exitOpen) return;
    exitDialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExitOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitOpen]);

  // Capture the start time on mount, then tick the countdown every second.
  useEffect(() => {
    const startedAt = Date.now();
    startedAtRef.current = startedAt;

    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = budgetSeconds - elapsed;
      if (left <= 0) {
        setRemaining(0);
        setTimeUp(true);
        window.clearInterval(id);
      } else {
        setRemaining(left);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [budgetSeconds]);

  /** Compute elapsed wall-clock seconds since mount (>= 0). */
  const elapsedSeconds = useCallback((): number => {
    const startedAt = startedAtRef.current;
    if (startedAt == null) return 0;
    return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  }, []);

  // The player finished all questions on its own.
  const handlePlayerComplete = useCallback(
    (answers: UserAnswer[], score: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onComplete(answers, score, elapsedSeconds());
    },
    [onComplete, elapsedSeconds],
  );

  // Finish the attempt with whatever was confirmed so far. QuizPlayer never
  // surfaces its partial answers to us, so everything counts as unanswered
  // (given "", correct false) => score 0. Duration is the wall-clock elapsed.
  // Shared by the time-up overlay and the Exit dialog's "Submit what I have".
  const submitWithMissed = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const answers: UserAnswer[] = quiz.questions.map((q) => ({
      questionId: q.id,
      given: "",
      correct: false,
    }));
    onComplete(answers, 0, elapsedSeconds());
  }, [onComplete, elapsedSeconds, quiz.questions]);

  // Time-up overlay "Finish" button: submit with missed answers.
  const handleTimeUpFinish = submitWithMissed;

  // Exit dialog "Submit what I have": close the dialog, then finish the attempt.
  const handleExitSubmit = useCallback(() => {
    setExitOpen(false);
    submitWithMissed();
  }, [submitWithMissed]);

  // Exit dialog "Discard": abandon the attempt and head back to /generate.
  const handleExitDiscard = useCallback(() => {
    setExitOpen(false);
    router.push("/generate");
  }, [router]);

  // Color thresholds: last 25% -> warning, last 10% -> destructive.
  const fraction = remaining / budgetSeconds;
  const isDanger = fraction <= 0.1;
  const isWarning = !isDanger && fraction <= 0.25;
  const tone: "brand" | "warning" | "danger" = isDanger
    ? "danger"
    : isWarning
      ? "warning"
      : "brand";

  // Pulse the clock in the final stretch — gated behind reduced motion.
  const shouldPulse = (isWarning || isDanger) && !reduceMotion && !timeUp;

  const clockColor = isDanger
    ? "text-destructive"
    : isWarning
      ? "text-warning"
      : "text-foreground";

  return (
    <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Countdown header */}
      <div
        className="glass sticky top-0 z-20 flex flex-col gap-2.5 rounded-2xl border border-border px-4 py-3"
        role="timer"
        aria-label="Time remaining"
        aria-live={isDanger ? "assertive" : "off"}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground-muted">
            <AlarmClock
              size={16}
              className={cn("shrink-0", clockColor)}
              aria-hidden="true"
            />
            Time left
          </span>
          <div className="flex items-center gap-3">
            <motion.span
              className={cn(
                "tabular-nums text-lg font-bold leading-none",
                clockColor,
              )}
              animate={
                shouldPulse ? { opacity: [1, 0.55, 1] } : { opacity: 1 }
              }
              transition={
                shouldPulse
                  ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0 }
              }
            >
              {formatClock(remaining)}
            </motion.span>
            {/* Exit affordance — opens the confirm dialog. Hidden once the
                attempt is over (time-up overlay takes priority). */}
            <button
              type="button"
              onClick={() => setExitOpen(true)}
              disabled={timeUp}
              aria-label="Exit quiz"
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                "text-foreground-muted transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "hover:bg-surface hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ProgressBar
          value={remaining}
          max={budgetSeconds}
          tone={tone}
          label={`${formatClock(remaining)} remaining of ${formatClock(budgetSeconds)}`}
        />
      </div>

      {/* The real player — all rendering + grading live here. When an overlay
          (time-up or exit) is open we mark this subtree `inert`: that removes it
          from the tab order AND blocks pointer/keyboard interaction, so the user
          can't keep answering behind the overlay (which previously let a
          post-deadline answer slip through) and keyboard focus can't fall into
          a hidden region. `inert` implies aria-hidden, so we don't need both. */}
      <div inert={timeUp || exitOpen || undefined}>
        <QuizPlayer quiz={quiz} onComplete={handlePlayerComplete} />
      </div>

      {/* Time's up overlay — shown only when the budget runs out first. */}
      {timeUp && (
        <div
          ref={timeUpRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg-deep/80 px-4 backdrop-blur-sm focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timeup-title"
          aria-describedby="timeup-desc"
        >
          <Card
            padding="lg"
            className="flex w-full max-w-md flex-col items-center gap-5 text-center"
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive"
              aria-hidden="true"
            >
              <TimerReset size={26} />
            </span>
            <div className="flex flex-col gap-2">
              <h2
                id="timeup-title"
                className="text-xl font-semibold text-foreground"
              >
                Time&apos;s up
              </h2>
              <p
                id="timeup-desc"
                className="text-sm text-foreground-muted"
              >
                Your {formatClock(budgetSeconds)} challenge clock ran out.
                Finish to see your results — any questions you didn&apos;t
                confirm in time are scored as missed.
              </p>
            </div>
            <Button
              onClick={handleTimeUpFinish}
              size="lg"
              fullWidth
              rightIcon={<Flag size={18} aria-hidden="true" />}
            >
              Finish &amp; see results
            </Button>
          </Card>
        </div>
      )}

      {/* Exit confirm dialog — same Card-overlay pattern as the time-up screen.
          Only shown when the attempt is still in progress. */}
      {exitOpen && !timeUp && (
        <div
          ref={exitDialogRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg-deep/80 px-4 backdrop-blur-sm focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-title"
          aria-describedby="exit-desc"
        >
          <Card
            padding="lg"
            className="flex w-full max-w-md flex-col items-center gap-5 text-center"
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning"
              aria-hidden="true"
            >
              <LogOut size={26} />
            </span>
            <div className="flex flex-col gap-2">
              <h2
                id="exit-title"
                className="text-xl font-semibold text-foreground"
              >
                Exit this quiz?
              </h2>
              <p id="exit-desc" className="text-sm text-foreground-muted">
                You can submit what you have so far — any questions you
                haven&apos;t confirmed are scored as missed — or discard this
                attempt entirely.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2.5">
              <Button
                onClick={handleExitSubmit}
                size="lg"
                fullWidth
                rightIcon={<Flag size={18} aria-hidden="true" />}
              >
                Submit what I have
              </Button>
              <Button
                onClick={handleExitDiscard}
                variant="danger"
                size="lg"
                fullWidth
                rightIcon={<LogOut size={18} aria-hidden="true" />}
              >
                Discard
              </Button>
              <Button
                onClick={() => setExitOpen(false)}
                variant="ghost"
                size="lg"
                fullWidth
              >
                Keep going
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
