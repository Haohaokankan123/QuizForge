"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  Lightbulb,
  TrendingUp,
  X,
} from "lucide-react";
import type { Question, Quiz, QuizMode, UserAnswer } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Props for {@link QuizPlayer}.
 * - `quiz`: the quiz to play (questions are shown one at a time).
 * - `onComplete`: called once after the final question is answered, with the
 *   full list of {@link UserAnswer} and the integer score (number correct).
 * - `mode`: how the quiz is PLAYED (see {@link QuizMode}). Defaults to 'exam'.
 *     - 'exam'      — answers hidden until the end; Previous/Next back-nav;
 *       graded once at Finish from the per-index working store.
 *     - 'practice'  — instant correct/wrong + explanation after each "Check";
 *       a second click advances. No back-nav.
 *     - 'adaptive'  — like practice (instant feedback, no back-nav) plus a
 *       running "level" that reorders the remaining question pool: correct
 *       answers raise the level and pull harder/later questions forward; misses
 *       lower it and pull easier/earlier ones forward. A level badge is shown.
 * - `onExit`: optional. Called when the user chooses "Discard" in the Exit
 *   dialog (the page wires this to router.push('/generate')). If omitted, the
 *   Exit dialog only offers "Submit what I have".
 */
export interface QuizPlayerProps {
  quiz: Quiz;
  onComplete: (answers: UserAnswer[], score: number) => void;
  mode?: QuizMode;
  onExit?: () => void;
}

/** Normalize a string for forgiving comparison: trim + lowercase + collapse spaces. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strip punctuation so token comparisons aren't thrown off by commas/periods. */
function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(" ")
    .filter(Boolean);
}

/**
 * Grade a single answer.
 *
 * - multiple_choice / true_false / fill_blank: case-insensitive, trimmed,
 *   whitespace-collapsed equality against the canonical answer.
 * - short_answer: forgiving. Correct if the normalized strings are equal, OR
 *   one string contains the other, OR the token overlap with the expected
 *   answer is high enough (>= 60% of the expected answer's significant tokens,
 *   ignoring short stop-words). Empty input is always wrong.
 */
function gradeAnswer(question: Question, given: string): boolean {
  const givenNorm = normalize(given);
  const answerNorm = normalize(question.answer);

  if (givenNorm.length === 0) return false;
  if (givenNorm === answerNorm) return true;

  if (question.type !== "short_answer") {
    return false;
  }

  // Lenient containment either direction (handles extra words / partial phrasing).
  if (
    answerNorm.length > 0 &&
    (givenNorm.includes(answerNorm) || answerNorm.includes(givenNorm))
  ) {
    return true;
  }

  // Token-overlap check against the expected answer's significant tokens.
  const expectedTokens = tokenize(question.answer).filter((t) => t.length > 2);
  if (expectedTokens.length === 0) return false;

  const givenSet = new Set(tokenize(given));
  const overlap = expectedTokens.filter((t) => givenSet.has(t)).length;
  return overlap / expectedTokens.length >= 0.6;
}

const QUESTION_TYPE_LABEL: Record<Question["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  fill_blank: "Fill in the blank",
  short_answer: "Short answer",
};

export default function QuizPlayer({
  quiz,
  onComplete,
  mode = "exam",
  onExit,
}: QuizPlayerProps) {
  const reduceMotion = useReducedMotion();
  const total = quiz.questions.length;

  // 'exam' shows answers only at the end with back-nav. 'practice' and
  // 'adaptive' both reveal feedback inline after each answer.
  const isExam = mode === "exam";
  const instantFeedback = mode === "practice" || mode === "adaptive";

  // ---------------------------------------------------------------------------
  // Question ORDER.
  //
  // Exam + practice play questions in their natural order. Adaptive plays in a
  // dynamic order that we extend one step at a time (see chooseNextAdaptive):
  // `order` is the sequence of question indices already shown, in show order.
  // We seed it with the first question (index 0) and append as the user
  // advances. `pos` is the cursor INTO `order` (so back-nav stays index-based
  // and consistent for every mode).
  // ---------------------------------------------------------------------------
  const [order, setOrder] = useState<number[]>(() => [0]);
  const [pos, setPos] = useState(0);

  // Running adaptive "level" (clamped 0..total-1). Rises on correct answers,
  // falls on misses; used to pick the next question from the remaining pool.
  const [level, setLevel] = useState(0);

  // The index (into quiz.questions) currently on screen.
  const currentIndex = order[pos];
  const question = quiz.questions[currentIndex];

  // ---------------------------------------------------------------------------
  // WORKING ANSWERS — keyed by the question's ORIGINAL index (not show order).
  // This is the user's in-progress response for each question; going Back
  // restores it, going Forward keeps it. Grading happens from this map: at the
  // end for exam mode, per-question for instant-feedback modes.
  // ---------------------------------------------------------------------------
  const [working, setWorking] = useState<Record<number, string>>({});

  // In instant-feedback modes, this flips true once the user clicks "Check" for
  // the current question (locking the answer and revealing correctness). Cleared
  // when we move to a new question.
  const [revealed, setRevealed] = useState(false);

  // Live score for instant-feedback modes (correct answers committed so far).
  const scoreRef = useRef(0);
  // Tracks which ORIGINAL indices have already been committed/graded, so a
  // re-reveal (shouldn't happen, but guard) can't double-count the score.
  const gradedRef = useRef<Set<number>>(new Set());

  // Hint state (practice + adaptive only). One hint string per question index.
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  // Exit confirmation dialog.
  const [exitOpen, setExitOpen] = useState(false);

  const isLast = pos === total - 1;

  // The user's current working text for the on-screen question.
  const currentGiven = question ? (working[currentIndex] ?? "") : "";
  const canAnswer = currentGiven.trim().length > 0;

  // Whether the current revealed answer is correct (instant-feedback modes).
  const currentCorrect = useMemo(() => {
    if (!revealed || !question) return false;
    return gradeAnswer(question, currentGiven.trim());
  }, [revealed, question, currentGiven]);

  /** Set the working answer for the current question (selection or typed text). */
  const setCurrentAnswer = useCallback(
    (value: string) => {
      setWorking((prev) => ({ ...prev, [currentIndex]: value }));
    },
    [currentIndex],
  );

  /** Build the final UserAnswer[] from the working map, grading every question. */
  const buildAnswers = useCallback((): { answers: UserAnswer[]; score: number } => {
    let score = 0;
    const answers = quiz.questions.map((q, i) => {
      const given = (working[i] ?? "").trim();
      const correct = gradeAnswer(q, given);
      if (correct) score += 1;
      return { questionId: q.id, given, correct } satisfies UserAnswer;
    });
    return { answers, score };
  }, [quiz.questions, working]);

  // ---------------------------------------------------------------------------
  // ADAPTIVE next-question selection.
  //
  // Given a target `level`, pick from the questions NOT yet shown the one whose
  // original index is closest to that level. Correct answers push the level up
  // (toward later/harder questions); misses pull it down (toward earlier/easier
  // ones). With a fixed quiz.questions array we treat original position as a
  // difficulty proxy — questions are authored easiest-first in practice, and
  // this guarantees we still show every question exactly once.
  // ---------------------------------------------------------------------------
  const chooseNextAdaptive = useCallback(
    (shown: number[], targetLevel: number): number => {
      const remaining: number[] = [];
      const seen = new Set(shown);
      for (let i = 0; i < total; i += 1) {
        if (!seen.has(i)) remaining.push(i);
      }
      // Closest remaining index to the target level (ties -> lower index).
      let best = remaining[0];
      let bestDist = Math.abs(best - targetLevel);
      for (const idx of remaining) {
        const dist = Math.abs(idx - targetLevel);
        if (dist < bestDist) {
          best = idx;
          bestDist = dist;
        }
      }
      return best;
    },
    [total],
  );

  /** Advance to the next question (committing instant-feedback score first). */
  const goNext = useCallback(() => {
    if (!question) return;

    // Compute the next adaptive level from THIS answer's correctness, so the
    // pick below reflects the just-answered result.
    let nextLevel = level;
    if (instantFeedback) {
      const correct = gradeAnswer(question, currentGiven.trim());
      nextLevel = Math.max(0, Math.min(total - 1, level + (correct ? 1 : -1)));
      if (mode === "adaptive") setLevel(nextLevel);
    }

    if (isLast) {
      const { answers, score } = buildAnswers();
      onComplete(answers, score);
      return;
    }

    // Decide which question index comes next.
    setOrder((prevOrder) => {
      if (mode === "adaptive") {
        const nextIdx = chooseNextAdaptive(prevOrder, nextLevel);
        return [...prevOrder, nextIdx];
      }
      // exam / practice: natural order — append the next sequential index.
      return [...prevOrder, prevOrder.length];
    });
    setPos((p) => p + 1);
    setRevealed(false);
    setHintError(null);
  }, [
    question,
    level,
    instantFeedback,
    mode,
    currentGiven,
    total,
    isLast,
    buildAnswers,
    onComplete,
    chooseNextAdaptive,
  ]);

  /** Go back one question (exam mode only). Working answers persist. */
  const goPrev = useCallback(() => {
    if (pos === 0) return;
    setPos((p) => p - 1);
    setRevealed(false);
    setHintError(null);
  }, [pos]);

  /** Reveal feedback for the current question (instant-feedback modes). */
  const reveal = useCallback(() => {
    if (!question || !canAnswer || revealed) return;
    const correct = gradeAnswer(question, currentGiven.trim());
    if (!gradedRef.current.has(currentIndex)) {
      gradedRef.current.add(currentIndex);
      if (correct) scoreRef.current += 1;
    }
    setRevealed(true);
  }, [question, canAnswer, revealed, currentGiven, currentIndex]);

  /**
   * The primary button does double duty in instant-feedback modes:
   *   1st click → Check (reveal); 2nd click → Next/Finish.
   * In exam mode it's always Next/Finish.
   */
  const primaryAction = useCallback(() => {
    if (instantFeedback && !revealed) {
      reveal();
      return;
    }
    goNext();
  }, [instantFeedback, revealed, reveal, goNext]);

  // Keyboard: number keys pick MC/TF options; Enter triggers the primary action.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!question || exitOpen) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      // Don't let number keys change a locked-in (revealed) answer.
      if (
        !revealed &&
        (question.type === "multiple_choice" ||
          question.type === "true_false") &&
        !inField
      ) {
        const opts = question.options ?? [];
        const num = Number.parseInt(e.key, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= opts.length) {
          e.preventDefault();
          setCurrentAnswer(opts[num - 1]);
          return;
        }
      }

      if (e.key === "Enter") {
        // In a textarea, Enter inserts a newline; require Cmd/Ctrl+Enter there.
        if (target?.tagName === "TEXTAREA" && !(e.metaKey || e.ctrlKey)) {
          return;
        }
        // Only gate the instant-feedback "Check" (it needs an answer). In exam
        // mode Next/Finish must work even on a blank (skipped) question — they're
        // graded as wrong at the end.
        if (instantFeedback && !revealed && !canAnswer) return;
        e.preventDefault();
        primaryAction();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    question,
    exitOpen,
    revealed,
    instantFeedback,
    isExam,
    canAnswer,
    primaryAction,
    setCurrentAnswer,
  ]);

  /** Fetch a hint for the current question (practice + adaptive). */
  const requestHint = useCallback(async () => {
    if (!question || hintLoading) return;
    setHintLoading(true);
    setHintError(null);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question.prompt,
          context: question.source_quote,
        }),
      });
      const data = (await res.json()) as { hint?: string; error?: string };
      if (!res.ok || data.error || !data.hint) {
        setHintError(data.error ?? "Couldn't get a hint. Try again.");
      } else {
        setHints((prev) => ({ ...prev, [currentIndex]: data.hint as string }));
      }
    } catch {
      setHintError("Couldn't get a hint. Check your connection.");
    } finally {
      setHintLoading(false);
    }
  }, [question, hintLoading, currentIndex]);

  // --- Exit dialog handlers ---------------------------------------------------

  /** "Submit what I have": grade every question (unanswered -> "" / false). */
  const handleSubmitPartial = useCallback(() => {
    const { answers, score } = buildAnswers();
    onComplete(answers, score);
  }, [buildAnswers, onComplete]);

  /** "Discard": no save — let the page navigate away. */
  const handleDiscard = useCallback(() => {
    setExitOpen(false);
    onExit?.();
  }, [onExit]);

  // Close the Exit dialog on Escape and move focus into it when it opens.
  const exitDialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exitOpen) return;
    exitDialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setExitOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitOpen]);

  if (!question) return null;

  const currentHint = hints[currentIndex];

  const motionEase = [0.16, 1, 0.3, 1] as const;
  const enter = reduceMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: 24 };
  const center = { opacity: 1, x: 0 };
  const exit = reduceMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -24 };

  // Primary button label: instant-feedback modes show Check first, then advance.
  const primaryLabel =
    instantFeedback && !revealed
      ? "Check"
      : isLast
        ? "Finish quiz"
        : "Next";
  // Only the instant-feedback "Check" requires an answer. Exam-mode Next/Finish
  // is always enabled so the student can SKIP a question and come back (blanks
  // are graded as wrong at the end).
  const primaryDisabled =
    instantFeedback && !revealed ? !canAnswer : false;
  const primaryIcon =
    instantFeedback && !revealed ? (
      <Check size={18} aria-hidden="true" />
    ) : isLast ? (
      <Flag size={18} aria-hidden="true" />
    ) : (
      <ArrowRight size={18} aria-hidden="true" />
    );

  return (
    <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Header: counter + difficulty/level + exit + progress */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground-muted tabular-nums">
            Question <span className="text-foreground">{pos + 1}</span> of{" "}
            {total}
          </span>
          <div className="flex items-center gap-2">
            {/* Adaptive level indicator — rises on correct, falls on wrong. */}
            {mode === "adaptive" && (
              <Badge variant="accent" size="sm" icon={<TrendingUp size={12} />}>
                Level {level + 1}
              </Badge>
            )}
            <Badge
              variant={
                quiz.difficulty === "easy"
                  ? "success"
                  : quiz.difficulty === "medium"
                    ? "warning"
                    : "danger"
              }
              size="sm"
            >
              {quiz.difficulty}
            </Badge>
            {/* Exit — opens a confirm dialog. Only shown when the page provides an
                onExit handler (e.g. /quiz/active). TimedQuiz supplies its OWN exit
                control, so it does NOT pass onExit and this button stays hidden,
                avoiding a duplicate "Exit quiz" button + a dead Discard path. */}
            {onExit && (
              <button
                type="button"
                onClick={() => setExitOpen(true)}
                aria-label="Exit quiz"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-bg-elevated text-foreground-muted transition-colors hover:border-white/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <ProgressBar
          value={pos + 1}
          max={total}
          label={`Question ${pos + 1} of ${total}`}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${currentIndex}-${pos}`}
          initial={enter}
          animate={center}
          exit={exit}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.35, ease: motionEase }
          }
        >
          <Card padding="lg" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Badge variant="accent" size="sm">
                {QUESTION_TYPE_LABEL[question.type]}
              </Badge>
              <h2 className="text-lg font-semibold leading-snug text-foreground sm:text-xl">
                {question.prompt}
              </h2>
            </div>

            <QuestionInput
              question={question}
              given={currentGiven}
              disabled={revealed}
              onSelect={setCurrentAnswer}
              onType={setCurrentAnswer}
              correctAnswer={question.answer}
              revealed={revealed}
              reduceMotion={Boolean(reduceMotion)}
            />

            {/* Hint (practice + adaptive). Never blocks answering. */}
            {instantFeedback && (
              <div className="flex flex-col gap-2">
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={requestHint}
                    loading={hintLoading}
                    disabled={hintLoading}
                    leftIcon={<Lightbulb size={16} aria-hidden="true" />}
                  >
                    {currentHint ? "Hint shown" : "Hint"}
                  </Button>
                </div>
                {currentHint && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
                    <Lightbulb
                      size={16}
                      className="mt-0.5 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-foreground">{currentHint}</p>
                  </div>
                )}
                {hintError && (
                  <p className="text-xs text-destructive" role="alert">
                    {hintError}
                  </p>
                )}
              </div>
            )}

            {/* Instant feedback (practice + adaptive) after Check. */}
            {instantFeedback && revealed && (
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border px-4 py-3.5",
                  currentCorrect
                    ? "border-success/30 bg-success/10"
                    : "border-destructive/30 bg-destructive/10",
                )}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={currentCorrect ? "success" : "danger"}
                    size="sm"
                  >
                    {currentCorrect ? "Correct" : "Not quite"}
                  </Badge>
                  {!currentCorrect && (
                    <span className="text-sm text-foreground">
                      Answer:{" "}
                      <span className="font-semibold">{question.answer}</span>
                    </span>
                  )}
                </div>
                {question.explanation && (
                  <p className="text-sm text-foreground-muted">
                    {question.explanation}
                  </p>
                )}
              </div>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Previous — exam mode only (instant-feedback modes have no back-nav). */}
          {isExam && (
            <Button
              variant="secondary"
              size="lg"
              onClick={goPrev}
              disabled={pos === 0}
              leftIcon={<ArrowLeft size={18} aria-hidden="true" />}
            >
              Previous
            </Button>
          )}
          <span className="hidden text-xs text-foreground-muted sm:inline">
            {question.type === "short_answer"
              ? "Cmd/Ctrl + Enter to continue"
              : "Enter to continue"}
          </span>
        </div>
        <Button
          onClick={primaryAction}
          disabled={primaryDisabled}
          size="lg"
          rightIcon={primaryIcon}
        >
          {primaryLabel}
        </Button>
      </div>

      {/* Exit confirmation dialog — pattern mirrors TimedQuiz's time-up overlay. */}
      {exitOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg-deep/80 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-title"
          aria-describedby="exit-desc"
          ref={exitDialogRef}
          tabIndex={-1}
        >
          <Card
            padding="lg"
            className="flex w-full max-w-md flex-col gap-5 text-center"
          >
            <div className="flex flex-col items-center gap-3">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning"
                aria-hidden="true"
              >
                <Flag size={26} />
              </span>
              <div className="flex flex-col gap-2">
                <h2
                  id="exit-title"
                  className="text-xl font-semibold text-foreground"
                >
                  Leave this quiz?
                </h2>
                <p id="exit-desc" className="text-sm text-foreground-muted">
                  You can submit what you have so far and see your results, or
                  discard this attempt without saving.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                onClick={handleSubmitPartial}
                size="lg"
                fullWidth
                rightIcon={<Flag size={18} aria-hidden="true" />}
              >
                Submit what I have
              </Button>
              <Button
                onClick={handleDiscard}
                variant="danger"
                size="lg"
                fullWidth
              >
                Discard
              </Button>
              <Button
                onClick={() => setExitOpen(false)}
                variant="ghost"
                size="md"
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

interface QuestionInputProps {
  question: Question;
  /** The user's current working answer (selection text or typed text). */
  given: string;
  /** When true, inputs are locked (answer revealed in instant-feedback modes). */
  disabled: boolean;
  onSelect: (value: string) => void;
  onType: (value: string) => void;
  /** The canonical correct answer (used to tint options once revealed). */
  correctAnswer: string;
  /** True once feedback is shown — drives correct/incorrect option coloring. */
  revealed: boolean;
  reduceMotion: boolean;
}

/** Renders the correct input control for the active question's type. */
function QuestionInput({
  question,
  given,
  disabled,
  onSelect,
  onType,
  correctAnswer,
  revealed,
}: QuestionInputProps) {
  if (question.type === "multiple_choice" || question.type === "true_false") {
    const options =
      question.type === "true_false"
        ? question.options ?? ["True", "False"]
        : question.options ?? [];

    return (
      <div
        role="radiogroup"
        aria-label="Answer choices"
        className="flex flex-col gap-3"
      >
        {options.map((option, i) => {
          const isSelected = given === option;
          // Once revealed, tint the correct option green and a wrong pick red.
          const isCorrectOption =
            revealed && normalize(option) === normalize(correctAnswer);
          const isWrongPick = revealed && isSelected && !isCorrectOption;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSelect(option)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left",
                "min-h-[52px]",
                disabled ? "cursor-default" : "cursor-pointer",
                "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                isCorrectOption
                  ? "border-success bg-success/10 text-foreground"
                  : isWrongPick
                    ? "border-destructive bg-destructive/10 text-foreground"
                    : isSelected
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border bg-bg-elevated text-foreground hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
                  isCorrectOption
                    ? "border-success bg-success text-white"
                    : isWrongPick
                      ? "border-destructive bg-destructive text-white"
                      : isSelected
                        ? "border-accent bg-accent text-white"
                        : "border-border text-foreground-muted group-hover:border-white/30",
                )}
                aria-hidden="true"
              >
                {isCorrectOption || isSelected ? <Check size={14} /> : i + 1}
              </span>
              <span className="text-sm sm:text-base">{option}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === "fill_blank") {
    return (
      <Input
        label="Your answer"
        hideLabel
        placeholder="Type the missing word or phrase…"
        value={given}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
        autoComplete="off"
        autoFocus
      />
    );
  }

  // short_answer
  return (
    <Textarea
      label="Your answer"
      hideLabel
      rows={4}
      placeholder="Write a brief answer in your own words…"
      value={given}
      disabled={disabled}
      onChange={(e) => onType(e.target.value)}
      autoFocus
    />
  );
}
