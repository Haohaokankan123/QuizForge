"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Flag } from "lucide-react";
import type { Question, Quiz, UserAnswer } from "@/lib/types";
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
 */
export interface QuizPlayerProps {
  quiz: Quiz;
  onComplete: (answers: UserAnswer[], score: number) => void;
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

export default function QuizPlayer({ quiz, onComplete }: QuizPlayerProps) {
  const reduceMotion = useReducedMotion();
  const total = quiz.questions.length;

  const [index, setIndex] = useState(0);
  // Collected answers, keyed by position so re-visits would overwrite cleanly.
  const answersRef = useRef<UserAnswer[]>([]);

  // The working response for the active question. `selected` holds the chosen
  // MC/TF option; `typed` holds fill_blank/short_answer text. Both are cleared
  // inside advance() (the only place `index` changes) so we never need a reset
  // effect — avoiding the React 19 set-state-in-effect cascade.
  const [selected, setSelected] = useState<string>("");
  const [typed, setTyped] = useState<string>("");

  const question = quiz.questions[index];
  const isLast = index === total - 1;

  const currentGiven = useMemo(() => {
    if (!question) return "";
    if (question.type === "multiple_choice" || question.type === "true_false") {
      return selected;
    }
    return typed;
  }, [question, selected, typed]);

  const canAdvance = currentGiven.trim().length > 0;

  const advance = useCallback(() => {
    if (!question || !canAdvance) return;

    const given = currentGiven.trim();
    const correct = gradeAnswer(question, given);

    const next = answersRef.current.slice();
    next[index] = { questionId: question.id, given, correct };
    answersRef.current = next;

    if (isLast) {
      const score = next.reduce((acc, a) => acc + (a?.correct ? 1 : 0), 0);
      onComplete(next, score);
      return;
    }
    // Clear the working response for the next question, then advance.
    setSelected("");
    setTyped("");
    setIndex((i) => i + 1);
  }, [question, canAdvance, currentGiven, index, isLast, onComplete]);

  // Keyboard: number keys pick MC/TF options; Enter advances when ready.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!question) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (
        (question.type === "multiple_choice" ||
          question.type === "true_false") &&
        !inField
      ) {
        const opts = question.options ?? [];
        const num = Number.parseInt(e.key, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= opts.length) {
          e.preventDefault();
          setSelected(opts[num - 1]);
          return;
        }
      }

      if (e.key === "Enter") {
        // In a textarea, Enter inserts a newline; require Cmd/Ctrl+Enter there.
        if (target?.tagName === "TEXTAREA" && !(e.metaKey || e.ctrlKey)) {
          return;
        }
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [question, advance]);

  if (!question) return null;

  const motionEase = [0.16, 1, 0.3, 1] as const;
  const enter = reduceMotion
    ? { opacity: 1, x: 0 }
    : { opacity: 0, x: 24 };
  const center = { opacity: 1, x: 0 };
  const exit = reduceMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -24 };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Header: counter + difficulty + progress */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground-muted tabular-nums">
            Question{" "}
            <span className="text-foreground">{index + 1}</span> of {total}
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
          value={index + 1}
          max={total}
          label={`Question ${index + 1} of ${total}`}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={question.id}
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
              selected={selected}
              typed={typed}
              onSelect={setSelected}
              onType={setTyped}
              reduceMotion={Boolean(reduceMotion)}
            />
          </Card>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-foreground-muted">
          {question.type === "short_answer"
            ? "Press Cmd/Ctrl + Enter to continue"
            : "Press Enter to continue"}
        </span>
        <Button
          onClick={advance}
          disabled={!canAdvance}
          size="lg"
          rightIcon={
            isLast ? <Flag size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />
          }
        >
          {isLast ? "Finish quiz" : "Next"}
        </Button>
      </div>
    </div>
  );
}

interface QuestionInputProps {
  question: Question;
  selected: string;
  typed: string;
  onSelect: (value: string) => void;
  onType: (value: string) => void;
  reduceMotion: boolean;
}

/** Renders the correct input control for the active question's type. */
function QuestionInput({
  question,
  selected,
  typed,
  onSelect,
  onType,
}: QuestionInputProps) {
  if (
    question.type === "multiple_choice" ||
    question.type === "true_false"
  ) {
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
          const isSelected = selected === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(option)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left",
                "min-h-[52px] cursor-pointer",
                "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                isSelected
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-bg-elevated text-foreground hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
                  isSelected
                    ? "border-accent bg-accent text-white"
                    : "border-border text-foreground-muted group-hover:border-white/30",
                )}
                aria-hidden="true"
              >
                {isSelected ? <Check size={14} /> : i + 1}
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
        value={typed}
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
      value={typed}
      onChange={(e) => onType(e.target.value)}
      autoFocus
    />
  );
}
