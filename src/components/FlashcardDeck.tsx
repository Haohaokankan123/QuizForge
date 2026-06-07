"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Lightbulb,
  Quote,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import type { Question, Quiz } from "@/lib/types";
import { Badge, Button, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Props for {@link FlashcardDeck}.
 * - `quiz`: the quiz whose questions become flashcards. Each question is one
 *   card: front = the prompt (plus options as hints for choice questions),
 *   back = the answer + explanation + the grounding source_quote.
 */
export interface FlashcardDeckProps {
  quiz: Quiz;
}

const EASE = [0.16, 1, 0.3, 1] as const;

const QUESTION_TYPE_LABEL: Record<Question["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  fill_blank: "Fill in the blank",
  short_answer: "Short answer",
};

/**
 * Fisher–Yates shuffle returning a NEW array (never mutates the input). Used by
 * the Shuffle control to reorder the deck without touching the source quiz.
 */
function shuffled<T>(items: T[]): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export default function FlashcardDeck({ quiz }: FlashcardDeckProps) {
  const reduceMotion = useReducedMotion();
  const total = quiz.questions.length;

  // `order` holds the indices of quiz.questions in the current display order.
  // Shuffling rewrites this array; the source quiz is never mutated.
  const [order, setOrder] = useState<number[]>(() =>
    quiz.questions.map((_, i) => i),
  );
  // Which position in `order` we're viewing.
  const [position, setPosition] = useState(0);
  // Whether the current card is flipped to show its answer side.
  const [flipped, setFlipped] = useState(false);

  const question = quiz.questions[order[position]];
  const isFirst = position === 0;
  const isLast = position === total - 1;

  const goTo = useCallback((nextPosition: number) => {
    // Re-hide the answer whenever we move to a different card so each card
    // starts on its question side.
    setFlipped(false);
    setPosition(nextPosition);
  }, []);

  const next = useCallback(() => {
    if (isLast) return;
    goTo(position + 1);
  }, [isLast, position, goTo]);

  const prev = useCallback(() => {
    if (isFirst) return;
    goTo(position - 1);
  }, [isFirst, position, goTo]);

  const flip = useCallback(() => {
    setFlipped((f) => !f);
  }, []);

  const shuffle = useCallback(() => {
    setFlipped(false);
    setOrder(shuffled(quiz.questions.map((_, i) => i)));
    setPosition(0);
  }, [quiz.questions]);

  const restart = useCallback(() => {
    setFlipped(false);
    setOrder(quiz.questions.map((_, i) => i));
    setPosition(0);
  }, [quiz.questions]);

  // Keyboard: Space/Enter flip, ArrowLeft/Right navigate. Ignore when focus is
  // inside a text field (none here, but future-proof) and let buttons keep their
  // own Enter/Space activation by skipping when a button is focused.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // If a button has focus, let the browser activate it (don't double-fire).
      if (tag === "BUTTON") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          prev();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          next();
        }
        return;
      }

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flip, prev, next]);

  if (!question) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Header: counter + difficulty + progress */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground-muted tabular-nums">
            Card <span className="text-foreground">{position + 1}</span> of {total}
          </span>
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
        </div>
        <ProgressBar
          value={position + 1}
          max={total}
          label={`Card ${position + 1} of ${total}`}
        />
      </div>

      {/* The card. AnimatePresence swaps between cards (slide); the inner flip
          rotates the same card between its two faces. Keying on the card index
          AND flip state isn't needed — flip is handled by the 3D transform. */}
      <Flashcard
        key={order[position]}
        question={question}
        flipped={flipped}
        onFlip={flip}
        reduceMotion={Boolean(reduceMotion)}
      />

      {/* Primary action: flip */}
      <div className="flex flex-col items-center gap-2">
        <Button
          onClick={flip}
          size="lg"
          variant="primary"
          fullWidth
          leftIcon={<RotateCcw size={18} aria-hidden="true" />}
        >
          {flipped ? "Show question" : "Show answer"}
        </Button>
        <span className="text-xs text-foreground-muted">
          Press Space or Enter to flip · ← → to move
        </span>
      </div>

      {/* Navigation + deck controls */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={prev}
            disabled={isFirst}
            variant="secondary"
            leftIcon={<ArrowLeft size={18} aria-hidden="true" />}
          >
            Previous
          </Button>
          <Button
            onClick={next}
            disabled={isLast}
            variant="secondary"
            rightIcon={<ArrowRight size={18} aria-hidden="true" />}
          >
            Next
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            onClick={shuffle}
            variant="ghost"
            size="sm"
            leftIcon={<Shuffle size={16} aria-hidden="true" />}
          >
            Shuffle
          </Button>
          <Button
            onClick={restart}
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw size={16} aria-hidden="true" />}
          >
            Restart
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FlashcardProps {
  question: Question;
  flipped: boolean;
  onFlip: () => void;
  reduceMotion: boolean;
}

/**
 * A single flashcard with a 3D rotateY flip. The outer button is the click /
 * focus target (the whole card is clickable to flip). When reduced motion is
 * requested we skip the 3D rotation and crossfade the two faces instead.
 */
function Flashcard({ question, flipped, onFlip, reduceMotion }: FlashcardProps) {
  // Tall, fixed-min-height stage so the front/back can be absolutely positioned
  // and stacked on each other for the flip.
  return (
    <button
      type="button"
      onClick={onFlip}
      aria-pressed={flipped}
      aria-label={flipped ? "Showing answer. Activate to show question." : "Showing question. Activate to show answer."}
      className={cn(
        "group relative block w-full cursor-pointer rounded-3xl text-left",
        "min-h-[20rem] sm:min-h-[24rem]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        "[perspective:1600px]",
      )}
    >
      {reduceMotion ? (
        // Reduced motion: crossfade between faces, no rotation.
        <div className="relative h-full min-h-[20rem] w-full sm:min-h-[24rem]">
          <AnimatePresence initial={false} mode="wait">
            {flipped ? (
              <motion.div
                key="back"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0"
              >
                <CardBack question={question} />
              </motion.div>
            ) : (
              <motion.div
                key="front"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0"
              >
                <CardFront question={question} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        // Full motion: a 3D Y-axis flip. The inner div rotates; each face is
        // backface-hidden so only the forward-facing side is visible.
        <motion.div
          className="relative h-full min-h-[20rem] w-full sm:min-h-[24rem] [transform-style:preserve-3d]"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]">
            <CardFront question={question} />
          </div>
          <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
            <CardBack question={question} />
          </div>
        </motion.div>
      )}
    </button>
  );
}

/** Shared face shell: glass surface, padding, ambient glow, hover lift cue. */
function FaceShell({
  children,
  tint,
}: {
  children: React.ReactNode;
  tint: "accent" | "success";
}) {
  return (
    <div
      className={cn(
        "glass relative flex h-full flex-col gap-5 overflow-hidden rounded-3xl p-6 sm:p-8",
        "transition-colors duration-200",
        "group-hover:border-white/15",
      )}
    >
      {/* Ambient corner glow, tinted per face. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full blur-3xl",
          tint === "accent"
            ? "bg-[radial-gradient(circle,var(--accent-glow),transparent_70%)]"
            : "bg-[radial-gradient(circle,rgba(52,211,153,0.25),transparent_70%)]",
        )}
      />
      {children}
    </div>
  );
}

/** Front of the card: question prompt (+ options as hints for choice types). */
function CardFront({ question }: { question: Question }) {
  const showHints =
    (question.type === "multiple_choice" || question.type === "true_false") &&
    Array.isArray(question.options) &&
    question.options.length > 0;

  return (
    <FaceShell tint="accent">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="accent" size="sm">
          {QUESTION_TYPE_LABEL[question.type]}
        </Badge>
        <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Question
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-5">
        <p className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">
          {question.prompt}
        </p>

        {showHints && (
          <ul className="flex flex-col gap-2" aria-label="Answer choices">
            {question.options!.map((option, i) => (
              <li
                key={option}
                className="flex items-center gap-3 rounded-2xl border border-border bg-bg-elevated/60 px-4 py-2.5"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-xs font-semibold tabular-nums text-foreground-muted"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="text-sm text-foreground">{option}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-foreground-muted">Tap the card to reveal the answer</p>
    </FaceShell>
  );
}

/** Back of the card: the answer, the explanation, and the source quote. */
function CardBack({ question }: { question: Question }) {
  return (
    <FaceShell tint="success">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="success" size="sm">
          Answer
        </Badge>
        <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          {QUESTION_TYPE_LABEL[question.type]}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        <p className="text-xl font-bold leading-snug text-success sm:text-2xl">
          {question.answer}
        </p>

        {question.explanation && (
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning"
              aria-hidden="true"
            >
              <Lightbulb size={14} />
            </span>
            <p className="text-sm leading-relaxed text-foreground-muted">
              {question.explanation}
            </p>
          </div>
        )}

        {question.source_quote && (
          <div className="rounded-2xl border border-border bg-bg-base/60 p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
              <Quote size={13} aria-hidden="true" />
              From your material
            </div>
            <blockquote className="text-sm italic leading-relaxed text-foreground">
              &ldquo;{question.source_quote}&rdquo;
            </blockquote>
          </div>
        )}
      </div>
    </FaceShell>
  );
}
