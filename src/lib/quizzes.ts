// Server-side data layer for quizzes + attempts (Supabase).
//
// WHAT THIS FILE IS:
//   A small set of async functions that read/write the `quizzes` and `attempts`
//   tables using the cookie-based Supabase SERVER client (@/lib/supabase/server).
//
// WHY IT EXISTS:
//   Persistence must happen server-side so it runs under the logged-in user's
//   session (cookies) and is protected by Row Level Security (RLS). Keeping all
//   DB access for quizzes/attempts in ONE module means the route handler and any
//   server actions never repeat the Supabase boilerplate, and the table/column
//   names live in exactly one place.
//
// WHERE TO USE IT:
//   ONLY from server code — Route Handlers (e.g. /api/generate), Server
//   Components, and Server Actions. NEVER import this from a "use client" file:
//   it pulls in @/lib/supabase/server, which uses next/headers (server-only).
//
// SECURITY NOTE:
//   The server client runs as the logged-in user, so RLS already restricts every
//   query to that user's own rows (the quizzes_owner_all / attempts_owner_all
//   policies). We still pass user_id explicitly on inserts because the columns
//   are NOT NULL and RLS's `with check` verifies auth.uid() = user_id.

import { createClient } from "@/lib/supabase/server";
import type { Quiz, UserAnswer } from "@/lib/types";

/**
 * The columns we read back for an attempt row. We also pull the related quiz's
 * presentational fields (title/difficulty/source_type/questions) so the
 * dashboard can render the same SavedAttempt shape it uses for localStorage.
 *
 * `quizzes` here is the joined row from the foreign key attempts.quiz_id ->
 * quizzes.id. Supabase returns it as a nested object (or null if quiz_id is
 * null / the quiz was deleted).
 */
export interface AttemptRow {
  id: string;
  quiz_id: string | null;
  score: number;
  total: number;
  answers: UserAnswer[];
  duration_seconds: number | null;
  created_at: string;
  quizzes: {
    title: string | null;
    difficulty: Quiz["difficulty"] | null;
    source_type: Quiz["source_type"] | null;
    questions: Quiz["questions"] | null;
  } | null;
}

/** A quiz row as stored in the `quizzes` table (DB superset of the Quiz type). */
export interface QuizRow {
  id: string;
  user_id: string;
  title: string;
  difficulty: Quiz["difficulty"];
  source_type: Quiz["source_type"];
  questions: Quiz["questions"];
  share_id: string | null;
  is_public: boolean;
  created_at: string;
}

/**
 * saveGeneratedQuiz — insert a freshly generated quiz for a user.
 *
 * Stores the presentational fields plus the full questions array (jsonb). We do
 * NOT store the LLM's transient `quiz.id`/`created_at`; the DB generates its own
 * uuid + created_at. Returns the new DB row id (so callers can link to it), or
 * null if the insert failed (best-effort — never throw and break generation).
 *
 * @param userId - the logged-in user's uuid (becomes quizzes.user_id).
 * @param quiz   - the generated Quiz to persist.
 */
export async function saveGeneratedQuiz(
  userId: string,
  quiz: Quiz,
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      user_id: userId,
      title: quiz.title,
      difficulty: quiz.difficulty,
      source_type: quiz.source_type,
      questions: quiz.questions,
    })
    .select("id")
    .single();

  if (error || !data) {
    return null;
  }
  return data.id as string;
}

/**
 * saveAttemptDb — record one finished quiz attempt for a user.
 *
 * @param userId          - the logged-in user's uuid (attempts.user_id).
 * @param quizId          - the DB quiz id this attempt belongs to, or null when
 *                          the quiz isn't in the DB (e.g. a shared/imported quiz
 *                          played without saving). quiz_id is nullable.
 * @param score           - number of correct answers.
 * @param total           - number of questions.
 * @param answers         - per-question answers (stored as jsonb).
 * @param durationSeconds - optional time spent (timed mode); null otherwise.
 * @returns the new attempt row id, or null on failure (best-effort).
 */
export async function saveAttemptDb(
  userId: string,
  quizId: string | null,
  score: number,
  total: number,
  answers: UserAnswer[],
  durationSeconds?: number,
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attempts")
    .insert({
      user_id: userId,
      quiz_id: quizId,
      score,
      total,
      answers,
      // Store null (not undefined) when no duration so the column is explicit.
      duration_seconds:
        typeof durationSeconds === "number" ? durationSeconds : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return null;
  }
  return data.id as string;
}

/**
 * listUserQuizzes — all of a user's quizzes, newest first.
 * RLS already scopes this to the user, but we filter by user_id too so the
 * (user_id, created_at desc) index is used. Returns [] on error.
 */
export async function listUserQuizzes(userId: string): Promise<QuizRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quizzes")
    .select(
      "id, user_id, title, difficulty, source_type, questions, share_id, is_public, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }
  return data as QuizRow[];
}

/**
 * listUserAttempts — all of a user's attempts, newest first, WITH the joined
 * quiz fields needed to render the dashboard history rows. Returns [] on error.
 *
 * The `quizzes(...)` selector is a Supabase foreign-table embed: it follows the
 * attempts.quiz_id -> quizzes.id relationship and returns the chosen columns as
 * a nested object on each attempt.
 */
export async function listUserAttempts(userId: string): Promise<AttemptRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attempts")
    .select(
      "id, quiz_id, score, total, answers, duration_seconds, created_at, quizzes ( title, difficulty, source_type, questions )",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }
  return data as unknown as AttemptRow[];
}

/**
 * countQuizzesThisWeek — how many quizzes the user generated in the last 7 days.
 *
 * Used by /api/generate to enforce the free weekly limit. We compute the cutoff
 * in JS (now - 7 days) and ask Postgres for an exact count without returning
 * rows (head: true + count: "exact"). Returns 0 on error so a transient DB
 * problem never wrongly blocks a user (the route can still proceed).
 */
export async function countQuizzesThisWeek(userId: string): Promise<number> {
  const supabase = await createClient();

  // 7 days ago, as an ISO timestamp Postgres can compare against created_at.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("quizzes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("created_at", cutoff);

  if (error || count === null) {
    return 0;
  }
  return count;
}
