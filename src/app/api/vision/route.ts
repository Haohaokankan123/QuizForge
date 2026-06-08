/**
 * POST /api/vision — read the text out of a photo (OCR via a vision model).
 *
 * This is a Next.js App Router Route Handler. The "photo" input flow calls it
 * with a data-URL image (camera capture or upload); it returns the extracted
 * plain text, which the client then feeds into /api/generate as normal content.
 *
 * Why this exists: the AI engine reads a SECRET API key (GROQ_API_KEY) and must
 * NEVER run in the browser. By putting it behind this route, the client only
 * ever talks to our own server, and the key stays safe.
 *
 * Contract:
 *   Request body  : { image: string } — a "data:image/...;base64,..." data URL
 *   Success (200) : { text: string } — the extracted text
 *   Failure (400) : { error: string } — bad/invalid/oversized request body
 *   Failure (401) : { error: string } — not signed in
 *   Failure (500) : { error: string } — the vision model failed
 *
 * AUTH: like /api/generate, the middleware matcher EXCLUDES /api, so this route
 * does its OWN cookie-based auth. OCR does NOT count toward the weekly quiz
 * limit — only quiz generations do — so we never touch that counter here.
 */

// `extractTextFromImage` runs Groq vision OCR (server-only, src/lib/llm.ts).
import { extractTextFromImage } from '@/lib/llm';

// Server-side Supabase client (cookie-based). Used here only to identify the
// caller. createClient() is ASYNC — it MUST be awaited.
import { createClient } from '@/lib/supabase/server';

// Force the Node.js runtime (not Edge). The AI engine and process.env access
// expect a full Node environment, so we pin it explicitly.
export const runtime = 'nodejs';

// Sanity cap on the incoming data URL. Base64 inflates raw bytes by ~33%, so
// ~12MB of string is roughly a 9MB image — generous for a phone photo while
// stopping an absurdly large body from reaching the vision model.
const MAX_IMAGE_CHARS = 12_000_000; // ~12 MB of base64 text

/** Small helper: returns the request body parsed as JSON, or null if it can't. */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Handles POST requests to /api/vision.
 *
 * @param req - the incoming web Request ({ image } JSON body, a data URL).
 * @returns a JSON Response: { text } on success, or { error } with a status.
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

  // 2. Validate: body must be an object with an `image` data-URL string.
  if (typeof body !== 'object' || body === null) {
    return Response.json(
      { error: 'Request body must be a JSON object.' },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;

  if (typeof b.image !== 'string' || b.image.trim().length === 0) {
    return Response.json(
      { error: 'No image was provided.' },
      { status: 400 },
    );
  }
  if (!b.image.startsWith('data:image/')) {
    return Response.json(
      { error: 'That does not look like a valid image.' },
      { status: 400 },
    );
  }
  // Guard body size so an oversized upload is rejected before we call the model.
  if (b.image.length > MAX_IMAGE_CHARS) {
    return Response.json(
      { error: 'That image is too large. Please use a smaller photo.' },
      { status: 400 },
    );
  }
  const image = b.image;

  // 3. Identify the caller. The middleware does NOT cover /api, so we auth here.
  //    getUser() re-validates the token with Supabase (a forged cookie fails).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: 'Please sign in to read text from a photo.' },
      { status: 401 },
    );
  }

  // 4. Run OCR. A failure surfaces as a friendly message (500 here, since at
  //    this point the request itself was well-formed and authorized).
  try {
    const text = await extractTextFromImage(image);
    return Response.json({ text });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Something went wrong while reading your photo.';
    return Response.json({ error: message }, { status: 500 });
  }
}
