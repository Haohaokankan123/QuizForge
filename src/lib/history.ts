/**
 * Local quiz history + attempts persistence for QuizForge.
 *
 * WHY THIS FILE EXISTS:
 * Right now we have no accounts/database. We still want users to keep their
 * quiz history (which quizzes they took, scores, dates) between page visits.
 * The browser gives us `localStorage` — a tiny key/value store that survives
 * page reloads. We keep ALL localStorage access in THIS one module so that
 * later, when we add Supabase, we only rewrite these functions and the rest
 * of the app (components/pages) never has to change.
 *
 * IMPORTANT NOTES FOR CONTRIBUTORS:
 * - This module is plain TypeScript (no React). It is safe to import from
 *   client components ("use client") and from plain helpers alike.
 * - Every function guards against running on the server (Next.js renders some
 *   code on the server where `window`/`localStorage` do not exist). On the
 *   server they return empty/no-op values instead of crashing.
 * - We never call Date.now()/Math.random() at module top-level (that would run
 *   during server render and cause hydration mismatches). They are only used
 *   inside functions, which run on user actions in the browser.
 * - All reads are wrapped in try/catch because saved JSON could be corrupt or
 *   from an older app version with a different shape.
 */

'use client';

import type { Quiz, UserAnswer } from '@/lib/types';

/**
 * The localStorage key under which the whole history array is stored.
 * The "_v1" suffix lets us bump to "_v2" later if the shape changes, so old
 * incompatible data is simply ignored instead of breaking the app.
 */
const STORAGE_KEY = 'qf_history_v1';

/** Keep at most this many attempts; older ones are dropped to bound storage. */
const MAX_ATTEMPTS = 100;

/**
 * One completed quiz attempt that we persist.
 * - id: unique id for this attempt (NOT the quiz id) so we can link/delete it.
 * - quiz: a full copy of the quiz that was taken (so review pages work even if
 *   the original generated quiz is gone from sessionStorage).
 * - answers: what the user gave per question, with correctness.
 * - score: number of correct answers.
 * - total: total number of questions (so percent = score / total).
 * - takenAt: ISO timestamp string of when the attempt finished.
 * - durationSeconds: optional time spent (used by timed mode).
 */
export interface SavedAttempt {
  id: string;
  quiz: Quiz;
  answers: UserAnswer[];
  score: number;
  total: number;
  takenAt: string;
  durationSeconds?: number;
}

/** Shape of stats returned to the dashboard. */
export interface HistoryStats {
  totalQuizzes: number;
  totalQuestions: number;
  totalCorrect: number;
  averagePercent: number;
  bestPercent: number;
  currentStreakDays: number;
  lastSevenDays: Array<{ date: string; count: number; avgPercent: number }>;
}

/**
 * True only when we are running in a browser (where localStorage exists).
 * Used as the very first check in every function so server-side calls no-op.
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Read and parse the raw array from localStorage.
 * Returns [] if we're on the server, if nothing is stored, if the JSON is
 * corrupt, or if the stored value is not an array (old/bad data).
 */
function readAll(): SavedAttempt[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard: stored value must be an array; anything else is treated as empty.
    if (!Array.isArray(parsed)) return [];
    // Light shape guard: keep only entries that look like SavedAttempt.
    return parsed.filter(isValidAttempt) as SavedAttempt[];
  } catch {
    // Corrupt JSON or any unexpected error -> behave as if there's no history.
    return [];
  }
}

/**
 * Minimal runtime check that an unknown value has the SavedAttempt fields we
 * rely on. Defends against malformed/old JSON without being overly strict.
 */
function isValidAttempt(value: unknown): value is SavedAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.takenAt === 'string' &&
    typeof v.score === 'number' &&
    typeof v.total === 'number' &&
    typeof v.quiz === 'object' &&
    v.quiz !== null &&
    Array.isArray(v.answers)
  );
}

/**
 * Write the array back to localStorage.
 * No-ops on the server; swallows quota/serialize errors so the app never
 * crashes just because saving failed.
 */
function writeAll(attempts: SavedAttempt[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Storage full / disabled (e.g. private mode): silently ignore.
  }
}

/**
 * Build a reasonably-unique id for a new attempt without needing a library.
 * Combines a timestamp (ms) with a short random suffix. Only ever called on a
 * user action in the browser, so using Date.now()/Math.random() here is safe.
 */
function makeId(createdAt: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `att_${createdAt}_${random}`;
}

/**
 * Save a finished attempt.
 *
 * The caller passes the record WITHOUT `id` and WITHOUT `takenAt` — those are
 * generated here. Optionally pass `createdAt` (ms since epoch) so callers can
 * make the timestamp deterministic in tests; otherwise we read the clock now.
 *
 * Returns the fully-built SavedAttempt (so callers can immediately link to it).
 * No-ops and returns null on the server.
 */
export function saveAttempt(
  record: Omit<SavedAttempt, 'id' | 'takenAt'>,
  createdAt?: number
): SavedAttempt | null {
  if (!isBrowser()) return null;

  // Use the provided timestamp if given, else the current time.
  const ts = typeof createdAt === 'number' ? createdAt : Date.now();

  const attempt: SavedAttempt = {
    ...record,
    id: makeId(ts),
    takenAt: new Date(ts).toISOString(),
  };

  // Newest first: put the new attempt at the front of the list.
  const next = [attempt, ...readAll()];

  // Cap to the most recent MAX_ATTEMPTS to keep localStorage small.
  writeAll(next.slice(0, MAX_ATTEMPTS));

  return attempt;
}

/**
 * Return all saved attempts, newest first.
 * readAll() already preserves insertion order (we always prepend), so the
 * stored order is newest-first; we still sort by takenAt to be safe against
 * any externally-tampered data.
 */
export function listAttempts(): SavedAttempt[] {
  const all = readAll();
  return all.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Find one attempt by its id, or undefined if not found / on the server. */
export function getAttempt(id: string): SavedAttempt | undefined {
  return readAll().find((a) => a.id === id);
}

/** Remove one attempt by id. No-op on the server or if the id isn't found. */
export function deleteAttempt(id: string): void {
  if (!isBrowser()) return;
  const next = readAll().filter((a) => a.id !== id);
  writeAll(next);
}

/** Remove ALL history. No-op on the server. */
export function clearHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Format a Date as a local "YYYY-MM-DD" day key (used to group by calendar
 * day for the streak + last-seven-days chart). We use LOCAL date parts (not
 * toISOString, which is UTC) so a quiz taken late at night counts on the
 * user's local day.
 */
function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Percentage (0-100, rounded) for an attempt, safe against total === 0. */
function attemptPercent(attempt: SavedAttempt): number {
  if (attempt.total <= 0) return 0;
  return Math.round((attempt.score / attempt.total) * 100);
}

/**
 * Compute dashboard statistics from a list of attempts.
 *
 * Pass in the result of listAttempts() (or any SavedAttempt[]). This function
 * is PURE — it does not touch localStorage — so it's easy to test and reuse.
 *
 * Everything is guarded against divide-by-zero: with an empty list you get all
 * zeros and an empty (but length-7) lastSevenDays array is still returned.
 *
 * Returned fields:
 * - totalQuizzes: how many attempts.
 * - totalQuestions: sum of every attempt's `total`.
 * - totalCorrect: sum of every attempt's `score`.
 * - averagePercent: mean of per-attempt percentages (rounded).
 * - bestPercent: highest single-attempt percentage.
 * - currentStreakDays: consecutive days (ending today) with >= 1 attempt.
 * - lastSevenDays: oldest->newest, one entry per day for the last 7 calendar
 *   days, each with { date, count, avgPercent }.
 */
export function computeStats(attempts: SavedAttempt[]): HistoryStats {
  // Safe default returned when there is nothing to summarise.
  const empty: HistoryStats = {
    totalQuizzes: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    averagePercent: 0,
    bestPercent: 0,
    currentStreakDays: 0,
    lastSevenDays: buildLastSevenDays([]),
  };

  if (!Array.isArray(attempts) || attempts.length === 0) return empty;

  const totalQuizzes = attempts.length;
  let totalQuestions = 0;
  let totalCorrect = 0;
  let percentSum = 0;
  let bestPercent = 0;

  for (const attempt of attempts) {
    totalQuestions += attempt.total;
    totalCorrect += attempt.score;
    const pct = attemptPercent(attempt);
    percentSum += pct;
    if (pct > bestPercent) bestPercent = pct;
  }

  // Divide-by-zero guard: totalQuizzes is >= 1 here, but stay explicit.
  const averagePercent = totalQuizzes > 0 ? Math.round(percentSum / totalQuizzes) : 0;

  return {
    totalQuizzes,
    totalQuestions,
    totalCorrect,
    averagePercent,
    bestPercent,
    currentStreakDays: computeStreakDays(attempts),
    lastSevenDays: buildLastSevenDays(attempts),
  };
}

/**
 * Count consecutive calendar days (ending today) that have >= 1 attempt.
 * Example: attempts today and yesterday but not the day before -> streak 2.
 * If there is no attempt today AND none yesterday, the streak is 0.
 * (We allow the streak to "still be alive" if the last activity was yesterday,
 * since the user may not have studied yet today.)
 */
function computeStreakDays(attempts: SavedAttempt[]): number {
  if (attempts.length === 0) return 0;

  // Collect the unique local day-keys on which any attempt happened.
  const days = new Set<string>();
  for (const attempt of attempts) {
    const d = new Date(attempt.takenAt);
    if (!Number.isNaN(d.getTime())) days.add(dayKey(d));
  }
  if (days.size === 0) return 0;

  // Start counting from today; if today has no activity but yesterday does,
  // start from yesterday so an unfinished "today" doesn't break the streak.
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  // Walk backwards one day at a time while each day has activity.
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Build a 7-element array (oldest day first, today last) summarising activity
 * for each of the last 7 calendar days.
 * - date: the "YYYY-MM-DD" day key.
 * - count: how many attempts happened that day.
 * - avgPercent: mean score% of those attempts (0 if none — no divide-by-zero).
 */
function buildLastSevenDays(
  attempts: SavedAttempt[]
): Array<{ date: string; count: number; avgPercent: number }> {
  // First, group percentages by day so we can average per day.
  const byDay = new Map<string, number[]>();
  for (const attempt of attempts) {
    const d = new Date(attempt.takenAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = dayKey(d);
    const list = byDay.get(key) ?? [];
    list.push(attemptPercent(attempt));
    byDay.set(key, list);
  }

  // Then emit exactly 7 day-buckets ending today.
  const result: Array<{ date: string; count: number; avgPercent: number }> = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 6); // start 6 days ago -> 7 days total

  for (let i = 0; i < 7; i += 1) {
    const key = dayKey(cursor);
    const percents = byDay.get(key) ?? [];
    const count = percents.length;
    const avgPercent =
      count > 0 ? Math.round(percents.reduce((sum, p) => sum + p, 0) / count) : 0;
    result.push({ date: key, count, avgPercent });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}
