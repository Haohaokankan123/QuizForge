"use client";

/**
 * /generate — the main "create a quiz" screen.
 *
 * This is the v1 input flow: the user pastes study material, picks which
 * question TYPES they want, a DIFFICULTY, and how MANY questions, then hits
 * "Generate Quiz". We POST those choices to /api/generate, which runs the
 * server-only AI engine (Groq) and returns a grounded Quiz.
 *
 * On success we stash the Quiz in sessionStorage (so the next screen can read
 * it without another network round-trip) and navigate to /quiz/active.
 *
 * Everything here runs in the browser ("use client") because it uses React
 * state, Framer Motion, and the Next.js client router.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  AlertCircle,
  ListChecks,
  ToggleLeft,
  TextCursorInput,
  PencilLine,
} from "lucide-react";

import {
  Button,
  Card,
  Skeleton,
  SkeletonText,
  SegmentedControl,
  Badge,
} from "@/components/ui";
import InputPicker from "@/components/InputPicker";
import AppNav from "@/components/AppNav";
import AuthGuard from "@/components/AuthGuard";
import type {
  Quiz,
  QuestionType,
  Difficulty,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants — the selectable options shown in the UI
// ---------------------------------------------------------------------------

/**
 * The sessionStorage key the next screen (/quiz/active) reads to load the quiz
 * that was just generated. Exported as a named constant so both the writer
 * (here) and the reader (the quiz page) reference the SAME string and can never
 * drift apart.
 */
export const ACTIVE_QUIZ_KEY = "qf_active_quiz";

/** All four question types, each with a label + icon for the toggle chips. */
const QUESTION_TYPE_OPTIONS: {
  value: QuestionType;
  label: string;
  icon: typeof ListChecks;
}[] = [
  { value: "multiple_choice", label: "Multiple choice", icon: ListChecks },
  { value: "true_false", label: "True / False", icon: ToggleLeft },
  { value: "fill_blank", label: "Fill in the blank", icon: TextCursorInput },
  { value: "short_answer", label: "Short answer", icon: PencilLine },
];

/** Difficulty options for the segmented control. */
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

/** Quick-pick question counts (shortcuts; user can also type any 1–30). */
const COUNT_PRESETS = [5, 10, 15, 20] as const;

/** Allowed range for the number of questions. */
const MIN_COUNT = 1;
const MAX_COUNT = 30;

/** Soft cap on pasted characters, mirroring the extractor's MAX_CHARS. */
const MAX_CONTENT_CHARS = 100_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GeneratePage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  // --- Form state ---
  const [content, setContent] = useState("");
  // Which input produced `content` (paste / file / youtube). Sent to the API
  // so the resulting Quiz records its true source. InputPicker reports this up.
  const [sourceType, setSourceType] = useState<
    "text" | "txt" | "pdf" | "docx" | "youtube"
  >("text");
  // Default: all four types selected (per the task spec).
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    "multiple_choice",
    "true_false",
    "fill_blank",
    "short_answer",
  ]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState<number>(5);
  // When on, the generated quiz launches in timed/challenge mode (countdown).
  const [timed, setTimed] = useState(false);

  // --- Request state ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the in-flight request's AbortController so the user can cancel a slow
  // generation (and so we can time it out) without losing their pasted content.
  const abortRef = useRef<AbortController | null>(null);

  // --- Derived validation ---
  const trimmedLength = content.trim().length;
  const hasContent = trimmedLength > 0;
  const hasTypes = selectedTypes.length > 0;
  const overLimit = content.length > MAX_CONTENT_CHARS;
  const canSubmit = hasContent && hasTypes && !overLimit && !loading;

  // A single helper line explaining why the button is disabled (if it is).
  const helperText = useMemo(() => {
    if (overLimit) {
      return `That's too long — keep it under ${MAX_CONTENT_CHARS.toLocaleString()} characters.`;
    }
    if (!hasContent && !hasTypes) {
      return "Paste some content and pick at least one question type to begin.";
    }
    if (!hasContent) return "Paste some study content to generate a quiz.";
    if (!hasTypes) return "Select at least one question type.";
    return null;
  }, [hasContent, hasTypes, overLimit]);

  // --- Handlers ---

  /** Toggle a question type on/off, but never let the list become empty-by-deselect mid-flow. */
  function toggleType(type: QuestionType) {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type],
    );
  }

  /** Cancel an in-flight generation, returning the user to the editable form
   *  with all their input intact (we only swap the view, never unmount it). */
  function handleCancel() {
    abortRef.current?.abort();
  }

  /** Submit the form: validate, POST to /api/generate, route on success. */
  async function handleGenerate() {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    // Abort the request if it runs too long (the engine can do several retry
    // rounds + per-chunk calls for big sources). Without this, a stalled network
    // or hung server would leave the user stuck on the loading skeleton forever
    // with no escape but a full reload (which loses their pasted content).
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          types: selectedTypes,
          difficulty,
          count,
          sourceType,
        }),
        signal: controller.signal,
      });

      // Read the body once; it's either a Quiz or { error }.
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Couldn't generate your quiz. Please try again.";
        setError(message);
        return;
      }

      // Success: persist the quiz, then go to the player. Timed mode routes to
      // the countdown variant; otherwise the normal untimed player.
      const quiz = data as Quiz;
      sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(quiz));
      router.push(timed ? "/quiz/timed" : "/quiz/active");
    } catch (err) {
      // An abort (user pressed Cancel, or the timeout fired) is not a real error
      // — show a calm, actionable message instead of a scary network one.
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "That took longer than expected. Try fewer questions or shorter material, then try again.",
        );
      } else {
        setError(
          "We couldn't reach the server. Check your connection and try again.",
        );
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setLoading(false);
    }
  }

  // --- Motion presets (all gated by reduceMotion) ---
  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: 0.5,
          ease: [0.16, 1, 0.3, 1] as const,
        },
      };

  return (
    <>
      <AppNav />
      <AuthGuard>
      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        {/* Header */}
      <motion.header
        {...fadeUp}
        className="mb-10 flex flex-col items-start gap-3"
      >
        <Badge variant="accent" icon={<Sparkles className="size-3.5" />}>
          AI quiz generator
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Turn your notes into a quiz
        </h1>
        <p className="max-w-xl text-base text-foreground-muted">
          Paste any study material below. QuizForge writes questions grounded
          only in your text — every answer comes with the exact source quote.
        </p>
      </motion.header>

      {/* When loading, replace the form with skeleton cards so the wait feels intentional. */}
      {loading ? (
        <LoadingState count={count} onCancel={handleCancel} />
      ) : (
        <motion.div
          {...fadeUp}
          transition={
            reduceMotion
              ? undefined
              : { duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }
          }
          className="flex flex-col gap-6"
        >
          {/* Source content — paste / upload / YouTube via the tabbed picker. */}
          <Card padding="lg" className="flex flex-col gap-3">
            <InputPicker
              value={content}
              onChange={setContent}
              onSourceTypeChange={setSourceType}
              maxChars={MAX_CONTENT_CHARS}
              disabled={loading}
            />
          </Card>

          {/* Options */}
          <Card padding="lg" className="flex flex-col gap-7">
            {/* Question types (multi-select chips) */}
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium text-foreground">
                Question types
              </legend>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
                  const active = selectedTypes.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleType(value)}
                      className={[
                        "inline-flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-medium",
                        "cursor-pointer select-none transition-colors duration-200",
                        "ease-[cubic-bezier(0.16,1,0.3,1)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                        active
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-bg-elevated text-foreground-muted hover:text-foreground hover:border-white/15",
                      ].join(" ")}
                    >
                      <Icon
                        className={
                          active
                            ? "size-4 text-accent"
                            : "size-4 text-foreground-muted"
                        }
                        aria-hidden="true"
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Difficulty */}
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium text-foreground">
                Difficulty
              </span>
              <SegmentedControl<Difficulty>
                ariaLabel="Difficulty"
                options={DIFFICULTY_OPTIONS}
                value={difficulty}
                onChange={setDifficulty}
              />
            </div>

            {/* Count — custom number input (1–30) plus quick presets */}
            <div className="flex flex-col gap-3">
              <label
                htmlFor="question-count"
                className="text-sm font-medium text-foreground"
              >
                Number of questions{" "}
                <span className="font-normal text-foreground-muted">
                  (1–{MAX_COUNT})
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {/* Stepper: minus / input / plus */}
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Fewer questions"
                    onClick={() =>
                      setCount((c) => Math.max(MIN_COUNT, c - 1))
                    }
                    disabled={count <= MIN_COUNT}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-bg-elevated text-lg font-semibold text-foreground-muted transition-colors duration-200 hover:text-foreground hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    id="question-count"
                    type="number"
                    inputMode="numeric"
                    min={MIN_COUNT}
                    max={MAX_COUNT}
                    value={count}
                    onChange={(e) => {
                      // Allow the field to be edited freely, then clamp on blur.
                      const n = parseInt(e.target.value, 10);
                      if (Number.isNaN(n)) {
                        setCount(MIN_COUNT);
                      } else {
                        setCount(Math.min(MAX_COUNT, Math.max(MIN_COUNT, n)));
                      }
                    }}
                    className="h-11 w-20 rounded-2xl border border-border bg-bg-elevated px-3 text-center text-base font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                  />
                  <button
                    type="button"
                    aria-label="More questions"
                    onClick={() =>
                      setCount((c) => Math.min(MAX_COUNT, c + 1))
                    }
                    disabled={count >= MAX_COUNT}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-bg-elevated text-lg font-semibold text-foreground-muted transition-colors duration-200 hover:text-foreground hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                {/* Quick presets */}
                <div className="flex flex-wrap gap-2">
                  {COUNT_PRESETS.map((n) => {
                    const active = count === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-label={`${n} questions`}
                        aria-pressed={active}
                        onClick={() => setCount(n)}
                        className={[
                          "inline-flex h-11 min-w-12 items-center justify-center rounded-2xl border px-3",
                          "text-sm font-semibold tabular-nums",
                          "cursor-pointer select-none transition-colors duration-200",
                          "ease-[cubic-bezier(0.16,1,0.3,1)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                          active
                            ? "border-accent bg-accent/15 text-foreground"
                            : "border-border bg-bg-elevated text-foreground-muted hover:text-foreground hover:border-white/15",
                        ].join(" ")}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Timed mode toggle */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  Timed mode
                </span>
                <span className="text-xs text-foreground-muted">
                  Add a countdown to practice under exam pressure.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={timed}
                aria-label="Timed mode"
                onClick={() => setTimed((t) => !t)}
                className={[
                  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full",
                  "cursor-pointer transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                  timed ? "bg-accent" : "bg-bg-elevated border border-border",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    timed ? "translate-x-6" : "translate-x-1",
                  ].join(" ")}
                  aria-hidden="true"
                />
              </button>
            </div>
          </Card>

          {/* Error banner */}
          {error && (
            <motion.div
              role="alert"
              initial={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
            >
              <AlertCircle
                className="mt-0.5 size-5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">{error}</p>
            </motion.div>
          )}

          {/* Submit */}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              fullWidth
              loading={loading}
              disabled={!canSubmit}
              onClick={handleGenerate}
              leftIcon={<Sparkles className="size-5" />}
            >
              Generate Quiz
            </Button>
            {helperText && (
              <p className="text-center text-xs text-foreground-muted">
                {helperText}
              </p>
            )}
          </div>
        </motion.div>
      )}
      </main>
      </AuthGuard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — shown while the AI generates the quiz
// ---------------------------------------------------------------------------

/** Honest, ordered phases shown while generating, so a long wait reads as
 *  progress instead of a freeze. The last one reassures on the slow long-tail. */
const LOADING_PHASES = [
  "Reading your material…",
  "Writing questions grounded in your text…",
  "Double-checking every answer…",
  "Longer material takes a bit more — hang tight.",
];

/**
 * A set of placeholder cards that approximate the quiz being built, so the wait
 * reads as deliberate progress rather than a frozen screen. We show up to a few
 * cards regardless of the requested count to avoid an overly long column.
 *
 * `onCancel` lets the user abort a slow generation and return to the form with
 * their input intact. The status line advances through LOADING_PHASES on a timer
 * so the screen visibly changes even though the request is opaque.
 */
function LoadingState({
  count,
  onCancel,
}: {
  count: number;
  onCancel: () => void;
}) {
  const cards = Math.min(Math.max(count, 1), 3);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Advance roughly every 4s, holding on the final reassurance line.
    const id = setInterval(() => {
      setPhase((p) => Math.min(p + 1, LOADING_PHASES.length - 1));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <Card padding="lg" className="flex items-center gap-3">
        <Skeleton radius="full" className="size-5" />
        <Skeleton className="h-4 w-56" />
      </Card>
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} padding="lg" className="flex flex-col gap-4">
          <Skeleton className="h-5 w-2/3" />
          <SkeletonText lines={3} />
          <div className="flex flex-col gap-2 pt-1">
            <Skeleton className="h-10 w-full" radius="lg" />
            <Skeleton className="h-10 w-full" radius="lg" />
          </div>
        </Card>
      ))}
      <p className="text-center text-sm text-foreground-muted">
        {LOADING_PHASES[phase]}
      </p>
      <div className="flex justify-center">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
