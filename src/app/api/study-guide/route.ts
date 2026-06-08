/**
 * POST /api/study-guide — turn study material into a one-page Markdown guide.
 *
 * This is a Next.js App Router Route Handler. The app calls it from the "Study
 * guide" button to get a concise, well-organized summary (key terms, definitions,
 * remember-this bullets) built ONLY from the provided material.
 *
 * Why this exists: the AI engine reads a SECRET API key (GROQ_API_KEY) and must
 * NEVER run in the browser. By putting it behind this route, the client only
 * ever talks to our own server, and the key stays safe.
 *
 * Contract:
 *   Request body  : { content: string }
 *   Success (200) : { guide: string } — the study guide as Markdown
 *   Failure (400) : { error: string } — bad/invalid request body
 *   Failure (401) : { error: string } — not signed in
 *   Failure (500) : { error: string } — the AI engine failed
 *
 * AUTH: like /api/generate, the middleware matcher EXCLUDES /api, so this route
 * does its OWN cookie-based auth. A study guide does NOT count toward the weekly
 * quiz limit — only quiz generations do — so we never touch that counter here.
 */

// `generateStudyGuide` builds the Markdown guide with the Groq engine
// (server-only, src/lib/llm.ts).
import { generateStudyGuide } from '@/lib/llm';

// Server-side Supabase client (cookie-based). Used here only to identify the
// caller. createClient() is ASYNC — it MUST be awaited.
import { createClient } from '@/lib/supabase/server';

// Force the Node.js runtime (not Edge). The AI engine and process.env access
// expect a full Node environment, so we pin it explicitly.
export const runtime = 'nodejs';

/** Small helper: returns the request body parsed as JSON, or null if it can't. */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Handles POST requests to /api/study-guide.
 *
 * @param req - the incoming web Request ({ content } JSON body).
 * @returns a JSON Response: { guide } on success, or { error } with a status.
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

  // 2. Validate: body must be an object with a non-empty `content` string.
  if (typeof body !== 'object' || body === null) {
    return Response.json(
      { error: 'Request body must be a JSON object.' },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;

  if (typeof b.content !== 'string' || b.content.trim().length === 0) {
    return Response.json(
      { error: 'Please provide some material to summarize.' },
      { status: 400 },
    );
  }
  const content = b.content;

  // 3. Identify the caller. The middleware does NOT cover /api, so we auth here.
  //    getUser() re-validates the token with Supabase (a forged cookie fails).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: 'Please sign in to make a study guide.' },
      { status: 401 },
    );
  }

  // 4. Call the AI engine. A failure surfaces as a friendly message (500 here,
  //    since at this point the request itself was well-formed and authorized).
  try {
    const guide = await generateStudyGuide(content);
    return Response.json({ guide });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Something went wrong while making your study guide.';
    return Response.json({ error: message }, { status: 500 });
  }
}
