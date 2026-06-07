"use client";

/**
 * /dashboard — the Progress Dashboard.
 *
 * Reads the user's local quiz history (localStorage, via @/lib/history) and
 * shows three things:
 *   1. A stats row (total quizzes, questions answered, average %, best %, streak).
 *   2. A last-7-days bar chart of quizzes-taken built from plain divs (no chart
 *      library) with an accessible text summary.
 *   3. A history list — one Card row per past attempt with Retry / Flashcards /
 *      Delete actions — newest first.
 * If there is no history yet, a friendly empty state invites the user to create
 * their first quiz.
 *
 * WHY "use client": everything here depends on the browser. Attempts come from
 * the auth-aware store (@/lib/store): when the user is signed in we read from
 * Supabase, otherwise we fall back to localStorage (the Slice 6 experience).
 * We load attempts in a mount effect (never during SSR) and show a loading line
 * until the first fetch resolves, so the loading state is distinguishable from a
 * genuinely empty history.
 *
 * MOTION: all reveals are mount-triggered (initial -> animate), gated behind
 * useReducedMotion(). We deliberately do NOT use Framer Motion whileInView +
 * viewport — that IntersectionObserver fails to fire on first paint and leaves
 * content stuck at opacity:0.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileQuestion,
  Flame,
  Layers,
  ListChecks,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import AppNav from "@/components/AppNav";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/cn";
import type { Quiz } from "@/lib/types";
import { computeStats, type HistoryStats } from "@/lib/history";
// Auth-aware attempts store: reads/writes Supabase when signed in, else
// localStorage. Same SavedAttempt shape either way (computeStats is reused).
import {
  deleteAttempt,
  getCurrentUserId,
  listAttempts,
  type SavedAttempt,
} from "@/lib/store";

/** sessionStorage key the active-quiz player reads (same as the generate flow). */
const ACTIVE_QUIZ_KEY = "qf_active_quiz";
/** Cleared on Retry so a stale finished result doesn't linger. */
const ACTIVE_RESULT_KEY = "qf_active_result";

/** Cinematic easing shared with the rest of the app. */
const EASE = [0.16, 1, 0.3, 1] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  // Attempts come from Supabase when signed in, else localStorage — decided by
  // getCurrentUserId() inside the effect below. `userId` is cached so the
  // delete handler writes back to the SAME store the list was read from.
  const [userId, setUserId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<SavedAttempt[]>([]);
  // false until the first load finishes; lets us show a loading line instead of
  // flashing the empty state (mirrors the old pre-hydration behaviour).
  const [loaded, setLoaded] = useState(false);
  // true if the load threw (e.g. Supabase query failed). Without this, a rejected
  // listAttempts() would leave `loaded` false forever → a permanent "Loading…".
  const [loadError, setLoadError] = useState(false);

  // Load (or reload) attempts: resolve who's signed in, then read the right
  // store. Wrapped in useCallback so the delete handler can re-run it.
  // try/catch/finally: on failure we surface an error card; finally ALWAYS marks
  // the load finished so the page never gets stuck on the loading line.
  const refresh = useCallback(async () => {
    setLoadError(false);
    setLoaded(false);
    try {
      const uid = await getCurrentUserId();
      const next = await listAttempts(uid);
      setUserId(uid);
      setAttempts(next);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial load after mount (localStorage + the browser Supabase client are
  // only available in the browser, so we read here, never during SSR).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const uid = await getCurrentUserId();
        const next = await listAttempts(uid);
        if (!active) return;
        setUserId(uid);
        setAttempts(next);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const stats = computeStats(attempts);

  /** Retry: re-arm the active quiz in sessionStorage, clear any stale result. */
  const handleRetry = useCallback(
    (quiz: Quiz) => {
      try {
        sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(quiz));
        sessionStorage.removeItem(ACTIVE_RESULT_KEY);
      } catch {
        // best effort — the active page shows its own empty state if this fails
      }
      router.push("/quiz/active");
    },
    [router],
  );

  /** Flashcards: stash the quiz and route to /flashcards (built separately). */
  const handleFlashcards = useCallback(
    (quiz: Quiz) => {
      try {
        sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(quiz));
      } catch {
        // best effort
      }
      router.push("/flashcards");
    },
    [router],
  );

  /** Delete one attempt from the right store, then optimistically drop it from
   *  the list so the UI updates immediately (no full reload). */
  const handleDelete = useCallback(
    (id: string) => {
      // Optimistic removal — the row disappears at once.
      setAttempts((prev) => prev.filter((a) => a.id !== id));
      // Persist the delete to whichever store this list came from.
      void deleteAttempt(userId, id).then((ok) => {
        // If the delete failed (rare), reload so the UI reflects the real state.
        if (!ok) void refresh();
      });
    },
    [userId, refresh],
  );

  return (
    <>
      <AppNav />
      <AuthGuard>
      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <motion.header
          className="mb-9 flex flex-col items-start gap-3"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE }}
        >
          <Badge variant="accent" icon={<BarChart3 className="size-3.5" />}>
            Your progress
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Dashboard
          </h1>
          <p className="max-w-xl text-base text-foreground-muted">
            Every quiz you take is saved on this device. Track your scores, keep
            your study streak alive, and jump back into any past quiz.
          </p>
        </motion.header>

        {/* Until the first load finishes: a quiet loading line (avoids flashing
            the empty state while we fetch from Supabase / localStorage). */}
        {!loaded ? (
          <p className="text-sm text-foreground-muted" aria-live="polite">
            Loading your progress…
          </p>
        ) : loadError ? (
          <Card padding="lg" className="flex max-w-md flex-col items-center gap-5 text-center" role="alert">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive"
              aria-hidden="true"
            >
              <AlertCircle size={26} />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-foreground">
                Couldn&apos;t load your progress
              </h2>
              <p className="text-sm text-foreground-muted">
                Something went wrong reaching your saved quizzes. Check your
                connection and try again.
              </p>
            </div>
            <Button onClick={() => void refresh()}>Try again</Button>
          </Card>
        ) : attempts.length === 0 ? (
          <EmptyState reduceMotion={reduceMotion} />
        ) : (
          <div className="flex flex-col gap-10">
            <StatsRow stats={stats} reduceMotion={reduceMotion} />
            <WeeklyChart stats={stats} reduceMotion={reduceMotion} />
            <HistoryList
              attempts={attempts}
              reduceMotion={reduceMotion}
              onRetry={handleRetry}
              onFlashcards={handleFlashcards}
              onDelete={handleDelete}
            />
          </div>
        )}
      </main>
      </AuthGuard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stats row
// ---------------------------------------------------------------------------

interface StatCardConfig {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  /** Tailwind text color class for the value + icon (gold for average/best). */
  accentClass: string;
}

function StatsRow({
  stats,
  reduceMotion,
}: {
  stats: HistoryStats;
  reduceMotion: boolean | null;
}) {
  const cards: StatCardConfig[] = [
    {
      key: "quizzes",
      label: "Total quizzes",
      value: String(stats.totalQuizzes),
      icon: ListChecks,
      accentClass: "text-accent",
    },
    {
      key: "questions",
      label: "Questions answered",
      value: String(stats.totalQuestions),
      icon: CheckCircle2,
      accentClass: "text-secondary",
    },
    {
      key: "average",
      label: "Average score",
      value: `${stats.averagePercent}%`,
      icon: Target,
      accentClass: "text-warning", // gold accent per spec
    },
    {
      key: "best",
      label: "Best score",
      value: `${stats.bestPercent}%`,
      icon: Trophy,
      accentClass: "text-warning", // gold accent per spec
    },
    {
      key: "streak",
      label: stats.currentStreakDays === 1 ? "Day streak" : "Day streak",
      value: String(stats.currentStreakDays),
      icon: Flame,
      accentClass: "text-success",
    },
  ];

  return (
    <section aria-label="Summary statistics">
      <h2 className="sr-only">Summary statistics</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(({ key, label, value, icon: Icon, accentClass }, i) => (
          <motion.div
            key={key}
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.45, ease: EASE, delay: i * 0.05 }
            }
          >
            <Card padding="md" className="flex h-full flex-col gap-3">
              <span
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-xl bg-white/[0.06]",
                  accentClass,
                )}
                aria-hidden="true"
              >
                <Icon className="size-4.5" />
              </span>
              <div className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-2xl font-extrabold tabular-nums sm:text-3xl",
                    accentClass,
                  )}
                >
                  {value}
                </span>
                <span className="text-xs font-medium text-foreground-muted">
                  {label}
                </span>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Last-7-days bar chart (plain divs, no chart library)
// ---------------------------------------------------------------------------

function WeeklyChart({
  stats,
  reduceMotion,
}: {
  stats: HistoryStats;
  reduceMotion: boolean | null;
}) {
  const days = stats.lastSevenDays; // oldest -> newest, today last
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const weekTotal = days.reduce((sum, d) => sum + d.count, 0);

  // A plain-text equivalent of the chart for screen readers / no-graphics users.
  const summary =
    weekTotal === 0
      ? "You haven't taken any quizzes in the last 7 days."
      : `You took ${weekTotal} ${
          weekTotal === 1 ? "quiz" : "quizzes"
        } in the last 7 days.`;

  return (
    <motion.section
      aria-label="Quizzes taken in the last 7 days"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE, delay: 0.1 }
      }
    >
      <Card padding="lg" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">
              Last 7 days
            </h2>
            <p className="text-sm text-foreground-muted">{summary}</p>
          </div>
          <Badge variant="neutral" icon={<BarChart3 className="size-3.5" />}>
            {weekTotal} total
          </Badge>
        </div>

        {/* Bars. Each column is a flex item; the bar height scales with count.
            The whole grid is hidden from screen readers (aria-hidden) because
            the summary above conveys the same information accessibly. */}
        <div
          className="flex items-end justify-between gap-2 sm:gap-3"
          aria-hidden="true"
        >
          {days.map((day, i) => {
            const heightPct = day.count > 0 ? (day.count / maxCount) * 100 : 0;
            return (
              <div
                key={day.date}
                className="flex min-w-0 flex-1 flex-col items-center gap-2"
                title={`${formatShortDate(day.date)}: ${day.count} ${
                  day.count === 1 ? "quiz" : "quizzes"
                }${day.count > 0 ? `, avg ${day.avgPercent}%` : ""}`}
              >
                {/* Track gives every column a consistent baseline + height. */}
                <div className="flex h-28 w-full items-end justify-center rounded-lg bg-white/[0.03]">
                  {day.count > 0 ? (
                    <motion.div
                      className="w-full max-w-9 rounded-lg bg-[linear-gradient(180deg,var(--secondary),var(--accent))]"
                      initial={
                        reduceMotion
                          ? false
                          : { height: 0, opacity: 0.5 }
                      }
                      animate={{
                        height: `${Math.max(heightPct, 8)}%`,
                        opacity: 1,
                      }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              duration: 0.5,
                              ease: EASE,
                              delay: 0.15 + i * 0.05,
                            }
                      }
                    />
                  ) : (
                    // Empty day: a faint baseline dash so the column isn't blank.
                    <div className="mb-1 h-1 w-4 rounded-full bg-white/10" />
                  )}
                </div>
                <span className="text-[11px] font-medium text-foreground-muted tabular-nums">
                  {formatWeekday(day.date)}
                </span>
                <span className="text-[11px] font-semibold text-foreground tabular-nums">
                  {day.count}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// History list
// ---------------------------------------------------------------------------

function HistoryList({
  attempts,
  reduceMotion,
  onRetry,
  onFlashcards,
  onDelete,
}: {
  attempts: SavedAttempt[];
  reduceMotion: boolean | null;
  onRetry: (quiz: Quiz) => void;
  onFlashcards: (quiz: Quiz) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section aria-label="Quiz history" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">History</h2>
        <span className="text-xs text-foreground-muted tabular-nums">
          {attempts.length} {attempts.length === 1 ? "attempt" : "attempts"}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {attempts.map((attempt, i) => (
          <motion.li
            key={attempt.id}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.4, ease: EASE, delay: Math.min(i, 8) * 0.04 }
            }
          >
            <HistoryRow
              attempt={attempt}
              onRetry={onRetry}
              onFlashcards={onFlashcards}
              onDelete={onDelete}
            />
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

function HistoryRow({
  attempt,
  onRetry,
  onFlashcards,
  onDelete,
}: {
  attempt: SavedAttempt;
  onRetry: (quiz: Quiz) => void;
  onFlashcards: (quiz: Quiz) => void;
  onDelete: (id: string) => void;
}) {
  const pct =
    attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const scoreTone = scoreVariant(pct);

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: title + meta */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="truncate font-semibold leading-snug text-foreground">
            {attempt.quiz.title || "Untitled quiz"}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sourceVariant(attempt.quiz.source_type)} size="sm">
              {sourceLabel(attempt.quiz.source_type)}
            </Badge>
            <Badge variant={difficultyVariant(attempt.quiz.difficulty)} size="sm">
              {capitalize(attempt.quiz.difficulty)}
            </Badge>
            <span className="text-xs text-foreground-muted tabular-nums">
              {formatDateTime(attempt.takenAt)}
            </span>
          </div>
        </div>

        {/* Right: score */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-lg font-extrabold tabular-nums text-foreground">
              {attempt.score}
              <span className="text-sm font-semibold text-foreground-muted">
                /{attempt.total}
              </span>
            </span>
            <Badge variant={scoreTone} size="sm">
              {pct}%
            </Badge>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onRetry(attempt.quiz)}
          leftIcon={<Sparkles className="size-4" aria-hidden="true" />}
        >
          Retry
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onFlashcards(attempt.quiz)}
          leftIcon={<Layers className="size-4" aria-hidden="true" />}
        >
          Flashcards
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(attempt.id)}
          aria-label={`Delete attempt: ${attempt.quiz.title || "Untitled quiz"}`}
          className="ml-auto text-foreground-muted hover:text-destructive"
          leftIcon={<Trash2 className="size-4" aria-hidden="true" />}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE }}
    >
      <Card
        variant="glass"
        padding="lg"
        className="relative mx-auto flex max-w-md flex-col items-center gap-5 overflow-hidden text-center"
      >
        {/* Soft ambient glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--accent-glow),transparent_70%)] blur-2xl"
        />
        <span
          className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"
          aria-hidden="true"
        >
          <FileQuestion size={26} />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-foreground">
            No quizzes yet
          </h2>
          <p className="text-sm text-foreground-muted">
            Take your first quiz and your scores, streak, and full history will
            show up right here.
          </p>
        </div>
        <Link
          href="/generate"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-7 text-base font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <Sparkles className="size-5" aria-hidden="true" />
          Create your first quiz
        </Link>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Small pure helpers (formatting + badge mapping)
// ---------------------------------------------------------------------------

/** Map a score percentage to a Badge color tier (gold for high scores). */
function scoreVariant(pct: number): BadgeVariant {
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "danger";
}

/** Difficulty -> badge color. */
function difficultyVariant(difficulty: Quiz["difficulty"]): BadgeVariant {
  if (difficulty === "easy") return "success";
  if (difficulty === "hard") return "danger";
  return "warning";
}

/** Source type -> badge color (kept neutral-ish so scores stand out). */
function sourceVariant(source: Quiz["source_type"]): BadgeVariant {
  switch (source) {
    case "youtube":
      return "danger";
    case "pdf":
      return "accent";
    case "docx":
      return "secondary";
    default:
      return "neutral";
  }
}

/** Human-friendly label for a source type. */
function sourceLabel(source: Quiz["source_type"]): string {
  switch (source) {
    case "youtube":
      return "YouTube";
    case "pdf":
      return "PDF";
    case "docx":
      return "Word";
    case "txt":
      return "Text file";
    case "text":
    default:
      return "Pasted text";
  }
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "Jun 6, 2026, 3:42 PM" style local date+time from an ISO string. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Mon" weekday from a "YYYY-MM-DD" day key (parsed as a LOCAL date). */
function formatWeekday(dayKey: string): string {
  const d = parseDayKey(dayKey);
  if (!d) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

/** "Jun 6" short date from a "YYYY-MM-DD" day key (parsed as a LOCAL date). */
function formatShortDate(dayKey: string): string {
  const d = parseDayKey(dayKey);
  if (!d) return dayKey;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Parse a "YYYY-MM-DD" key into a LOCAL Date (midnight local time).
 * We split + construct manually instead of `new Date("YYYY-MM-DD")` because the
 * string form is parsed as UTC, which can shift the weekday label by a day in
 * negative-offset timezones. history.ts builds these keys from local dates, so
 * we read them back as local too.
 */
function parseDayKey(dayKey: string): Date | null {
  const parts = dayKey.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day);
}
