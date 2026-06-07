/**
 * POST /api/generate — the quiz-generation API endpoint.
 *
 * This is a Next.js App Router Route Handler. It receives the user's request
 * from the /generate page, validates it, calls the server-only AI engine to
 * build a grounded quiz, and returns that Quiz as JSON.
 *
 * Why this exists: the AI engine reads a SECRET API key (GROQ_API_KEY) and must
 * NEVER run in the browser. By putting it behind this route, the client only
 * ever talks to our own server, and the key stays safe.
 *
 * Contract:
 *   Request body  : GenerateRequest JSON
 *   Success (200) : the full Quiz object as JSON (with a `db_id` field when the
 *                   quiz was saved to the database for the logged-in user)
 *   Failure (400) : { error: string } — bad/invalid request body
 *   Failure (401) : { error: string } — not signed in
 *   Failure (429) : { error: string } — weekly free limit reached
 *
 * AUTH + LIMIT (Slice 5):
 *   The middleware matcher EXCLUDES /api, so this route does its OWN auth using
 *   the cookie-based Supabase server client. A free user may generate at most 20
 *   quizzes per rolling 7 days; the owner account (is_owner / OWNER_EMAIL) is
 *   unlimited. On success the quiz is also saved to the DB for that user.
 */

// `generateQuiz` is the single public export of the server-only AI engine
// (Groq, in src/lib/llm.ts). It throws friendly Error messages we forward to
// the client on failure.
import { generateQuiz } from '@/lib/llm';

// Server-side Supabase client (cookie-based). Used here to identify the caller
// and read their profile. createClient() is ASYNC — it MUST be awaited.
import { createClient } from '@/lib/supabase/server';

// Server-side data layer: counts the user's quizzes this week + saves the quiz.
import { countQuizzesThisWeek, saveGeneratedQuiz } from '@/lib/quizzes';

// We only need the types at compile time (`import type` keeps them out of the
// runtime bundle). These are the shared QuizForge shapes.
import type { GenerateRequest, QuestionType, Difficulty } from '@/lib/types';

// Force the Node.js runtime (not Edge). The AI engine and process.env access
// expect a full Node environment, so we pin it explicitly.
export const runtime = 'nodejs';

// Free accounts may generate at most this many quizzes per rolling 7 days.
// The owner account bypasses this entirely.
const WEEKLY_FREE_LIMIT = 20;

// The only question types we accept. Used to reject anything unexpected.
const VALID_TYPES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
];

// The only difficulties we accept.
const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

// The source types a Quiz may declare. This slice only sends 'text', but we
// validate against the full set so the route is correct as more inputs land.
const VALID_SOURCE_TYPES: GenerateRequest['sourceType'][] = [
  'text',
  'txt',
  'pdf',
  'docx',
  'youtube',
];

/** Small helper: returns the request body parsed as JSON, or null if it can't. */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Validates and narrows the raw request body into a typed GenerateRequest.
 * Returns either { ok: true, value } or { ok: false, error } so the caller can
 * respond with a precise, friendly message.
 */
function validateBody(
  body: unknown,
):
  | { ok: true; value: GenerateRequest }
  | { ok: false; error: string } {
  // The body must be a plain object.
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const b = body as Record<string, unknown>;

  // --- content: non-empty string ---
  if (typeof b.content !== 'string' || b.content.trim().length === 0) {
    return { ok: false, error: 'Please provide some source content to study.' };
  }

  // --- types: a non-empty array, every item one of the 4 valid types ---
  if (!Array.isArray(b.types) || b.types.length === 0) {
    return { ok: false, error: 'Select at least one question type.' };
  }
  const everyTypeValid = b.types.every(
    (t): t is QuestionType =>
      typeof t === 'string' && VALID_TYPES.includes(t as QuestionType),
  );
  if (!everyTypeValid) {
    return { ok: false, error: 'One or more question types are invalid.' };
  }
  // De-duplicate while preserving the typed union.
  const types = Array.from(new Set(b.types)) as QuestionType[];

  // --- difficulty: one of easy/medium/hard ---
  if (
    typeof b.difficulty !== 'string' ||
    !VALID_DIFFICULTIES.includes(b.difficulty as Difficulty)
  ) {
    return { ok: false, error: 'Difficulty must be easy, medium, or hard.' };
  }
  const difficulty = b.difficulty as Difficulty;

  // --- count: an integer from 1 to 30 ---
  if (
    typeof b.count !== 'number' ||
    !Number.isInteger(b.count) ||
    b.count < 1 ||
    b.count > 30
  ) {
    return {
      ok: false,
      error: 'Number of questions must be a whole number between 1 and 30.',
    };
  }
  const count = b.count;

  // --- sourceType: one of the allowed source kinds ---
  if (
    typeof b.sourceType !== 'string' ||
    !VALID_SOURCE_TYPES.includes(
      b.sourceType as GenerateRequest['sourceType'],
    )
  ) {
    return { ok: false, error: 'Invalid source type.' };
  }
  const sourceType = b.sourceType as GenerateRequest['sourceType'];

  return {
    ok: true,
    value: {
      content: b.content,
      types,
      difficulty,
      count,
      sourceType,
    },
  };
}

/**
 * Handles POST requests to /api/generate.
 *
 * @param req - the incoming web Request (its JSON body is a GenerateRequest).
 * @returns a JSON Response: the Quiz on success, or { error } with status 400.
 */
export async function POST(req: Request): Promise<Response> {
  // 1. Parse the JSON body.
  const body = await readJsonBody(req);
  if (body === null) {
    return Response.json(
      { error: 'Could not read the request body as JSON.' },
      { status: 400 },
    );
  }

  // 2. Validate + narrow the body to a typed GenerateRequest.
  const validated = validateBody(body);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  // 3. Identify the caller. The middleware does NOT cover /api, so we auth here.
  //    getUser() re-validates the token with Supabase (a forged cookie fails).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: 'Please sign in to generate a quiz.' },
      { status: 401 },
    );
  }

  // 4. Decide if this user is the unlimited owner. We check BOTH the profile's
  //    is_owner flag AND the email against OWNER_EMAIL, so the owner is never
  //    wrongly limited even if the profiles row hasn't been read/created yet.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_owner')
    .eq('id', user.id)
    .single();

  const isOwner =
    profile?.is_owner === true ||
    (typeof user.email === 'string' &&
      typeof process.env.OWNER_EMAIL === 'string' &&
      user.email === process.env.OWNER_EMAIL);

  // 5. Enforce the weekly free limit for non-owners. countQuizzesThisWeek
  //    returns 0 on any DB error, so a transient failure never wrongly blocks.
  if (!isOwner) {
    const used = await countQuizzesThisWeek(user.id);
    if (used >= WEEKLY_FREE_LIMIT) {
      return Response.json(
        {
          error:
            'You have reached the free limit of 20 quizzes this week. It resets 7 days after your earliest quiz. (The owner account is unlimited.)',
        },
        { status: 429 },
      );
    }
  }

  // 6. Only AFTER passing the limit, call the AI engine. Any failure surfaces as
  //    a friendly Error message that the client shows inline.
  let quiz;
  try {
    quiz = await generateQuiz(validated.value);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Something went wrong while generating your quiz.';
    return Response.json({ error: message }, { status: 400 });
  }

  // 7. Save the generated quiz to the DB for this user (best-effort). If the
  //    save fails we still return the quiz so the user can take it — they just
  //    won't see it in their saved history. The DB row id (if any) is attached
  //    as `db_id` so later screens can link the attempt to the quiz.
  const dbId = await saveGeneratedQuiz(user.id, quiz);

  return Response.json(dbId ? { ...quiz, db_id: dbId } : quiz);
}
