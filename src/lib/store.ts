"use client";

// Auth-aware attempts store for the BROWSER.
//
// WHAT THIS FILE IS:
//   A thin layer that exposes the SAME shape the dashboard already expects
//   (SavedAttempt) but chooses WHERE the data lives:
//     - logged IN  -> Supabase (the `attempts` table, via the browser client)
//     - logged OUT -> localStorage (the existing @/lib/history store)
//
// WHY IT EXISTS:
//   Slice 6 shipped a localStorage-only experience that must keep working for
//   signed-out visitors. Slice 5 adds accounts + a database. Rather than rewrite
//   every page, we centralise the "which store?" decision here so the dashboard
//   (and the results/timed save paths) can stay simple.
//
// KEY POINTS:
//   - This runs in the browser ("use client"). It uses the SYNC browser Supabase
//     client (@/lib/supabase/client — do NOT await createClient()).
//   - computeStats is REUSED from @/lib/history (it's a pure function), so stats
//     math is identical whether attempts came from the DB or localStorage.
//   - DB rows are mapped into the SavedAttempt shape so the dashboard UI is
//     unchanged. A SavedAttempt needs a full `quiz`; for DB attempts we
//     reconstruct a minimal Quiz from the joined quizzes columns.
//   - Everything is best-effort and falls back to localStorage on any error so
//     the dashboard never hard-crashes on a network/DB hiccup.

import type { Quiz } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  deleteAttempt as deleteLocalAttempt,
  listAttempts as listLocalAttempts,
  saveAttempt as saveLocalAttempt,
  type SavedAttempt,
} from "@/lib/history";

/** Re-export so callers can `import { computeStats } from "@/lib/store"` if they
 *  prefer one import; it is the SAME pure function from history.ts. */
export { computeStats } from "@/lib/history";
export type { SavedAttempt, HistoryStats } from "@/lib/history";

/**
 * The current signed-in user's id, or null if signed out.
 *
 * Uses getUser() (re-validates the token) rather than getSession() so we trust
 * the answer. Returns null on any error so callers fall back to localStorage.
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The raw attempt row shape we read from Supabase, including the joined quiz
 * columns. Mirrors AttemptRow in @/lib/quizzes but defined here so this client
 * file does not import the server-only module.
 */
interface DbAttemptRow {
  id: string;
  quiz_id: string | null;
  score: number;
  total: number;
  answers: unknown;
  duration_seconds: number | null;
  created_at: string;
  quizzes: {
    title: string | null;
    difficulty: Quiz["difficulty"] | null;
    source_type: Quiz["source_type"] | null;
    questions: Quiz["questions"] | null;
  } | null;
}

/**
 * Convert one DB attempt row into the SavedAttempt shape the dashboard renders.
 * We rebuild a minimal Quiz from the joined `quizzes` columns. If the quiz was
 * deleted (join is null) we still show the attempt with a placeholder quiz so
 * the row + score stay visible.
 */
function rowToSavedAttempt(row: DbAttemptRow): SavedAttempt {
  const q = row.quizzes;
  const quiz: Quiz = {
    // Use the DB quiz id when present so Retry/Flashcards re-arm a real quiz.
    id: row.quiz_id ?? row.id,
    title: q?.title ?? "Untitled quiz",
    difficulty: q?.difficulty ?? "medium",
    source_type: q?.source_type ?? "text",
    questions: Array.isArray(q?.questions) ? q!.questions : [],
  };

  return {
    // Prefix the id so a DB attempt id never collides with a localStorage one,
    // and so the dashboard's delete handler can tell which store to delete from.
    id: row.id,
    quiz,
    answers: Array.isArray(row.answers)
      ? (row.answers as SavedAttempt["answers"])
      : [],
    score: row.score,
    total: row.total,
    takenAt: row.created_at,
    durationSeconds: row.duration_seconds ?? undefined,
  };
}

/**
 * listAttempts — read attempts from the right store.
 *
 * If a user id is given, read from Supabase (newest first) and map to
 * SavedAttempt. On any DB error, fall back to localStorage so the dashboard
 * still shows something. If no user id, read localStorage directly.
 *
 * @param userId - the signed-in user's id, or null when signed out.
 */
export async function listAttempts(
  userId: string | null,
): Promise<SavedAttempt[]> {
  if (!userId) {
    // Signed out: the existing localStorage history is the source of truth.
    return listLocalAttempts();
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("attempts")
      .select(
        "id, quiz_id, score, total, answers, duration_seconds, created_at, quizzes ( title, difficulty, source_type, questions )",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      return listLocalAttempts();
    }
    return (data as unknown as DbAttemptRow[]).map(rowToSavedAttempt);
  } catch {
    // Network/DB failure: degrade to localStorage rather than show nothing.
    return listLocalAttempts();
  }
}

/**
 * Result of saving an attempt: which store it went to + the new id (DB row id,
 * or the localStorage attempt id). Best-effort: `ok` is false if both failed.
 */
export interface SaveAttemptResult {
  ok: boolean;
  store: "db" | "local";
  id: string | null;
}

/** The payload to persist — identical to the localStorage saveAttempt input. */
export type SaveAttemptInput = Omit<SavedAttempt, "id" | "takenAt"> & {
  /** The DB quiz id, when known (so attempts.quiz_id links to the quiz). */
  quizId?: string | null;
};

/**
 * saveAttempt — persist a finished attempt to the right store.
 *
 * Logged IN: insert into Supabase `attempts` (best-effort). quiz_id is set from
 *   `quizId` when provided, else null (attempts.quiz_id is nullable).
 * Logged OUT: write to localStorage via the existing history.saveAttempt.
 *
 * Never throws — returns a SaveAttemptResult so callers (results/timed pages)
 * can stay best-effort and never block the UI.
 *
 * @param userId - the signed-in user's id, or null when signed out.
 * @param record - the attempt to save (quiz, answers, score, total, ...).
 */
export async function saveAttempt(
  userId: string | null,
  record: SaveAttemptInput,
): Promise<SaveAttemptResult> {
  if (!userId) {
    // Signed out: keep the localStorage path exactly as before.
    const saved = saveLocalAttempt({
      quiz: record.quiz,
      answers: record.answers,
      score: record.score,
      total: record.total,
      durationSeconds: record.durationSeconds,
    });
    return { ok: Boolean(saved), store: "local", id: saved?.id ?? null };
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("attempts")
      .insert({
        user_id: userId,
        quiz_id: record.quizId ?? null,
        score: record.score,
        total: record.total,
        answers: record.answers,
        duration_seconds:
          typeof record.durationSeconds === "number"
            ? record.durationSeconds
            : null,
      })
      .select("id")
      .single();

    if (error || !data) {
      return { ok: false, store: "db", id: null };
    }
    return { ok: true, store: "db", id: data.id as string };
  } catch {
    return { ok: false, store: "db", id: null };
  }
}

/**
 * deleteAttempt — remove one attempt from the right store.
 *
 * Logged IN: delete the row from Supabase (RLS ensures only the owner's row is
 *   affected). Logged OUT: delete from localStorage.
 * Returns true on success, false on failure. Never throws.
 *
 * @param userId - the signed-in user's id, or null when signed out.
 * @param id     - the attempt id (DB row id, or localStorage attempt id).
 */
export async function deleteAttempt(
  userId: string | null,
  id: string,
): Promise<boolean> {
  if (!userId) {
    deleteLocalAttempt(id);
    return true;
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("attempts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}
