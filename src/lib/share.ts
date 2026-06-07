/**
 * Stateless shareable links for QuizForge quizzes.
 *
 * The ENTIRE quiz is encoded into the URL itself — there is no backend and no
 * database lookup. encodeQuizToParam() turns a Quiz into a URL-safe string;
 * decodeQuizFromParam() reverses it. buildShareUrl() wraps that into a full
 * "/share?q=..." link a recipient can open with no account.
 *
 * Tradeoff: because the whole quiz rides in the query string, links grow with
 * quiz size and very large quizzes can exceed practical URL limits (~2k chars in
 * older browsers, more in modern ones). This is intentional for a no-backend MVP.
 *
 * FUTURE: replace this with a Supabase-backed short link — store the quiz once,
 * key it by a short id, and share "/share?id=<short>" instead. encode/decode can
 * stay as a fallback for offline/self-contained links. The page contract
 * (read a param, resolve a Quiz, hand it to the active flow) would not change.
 *
 * Encoding pipeline (encode):
 *   Quiz -> compact JSON -> UTF-8-safe %-escape -> base64 (btoa) -> URL-safe
 * Decoding reverses each step and minimally validates the shape.
 */

import type { Quiz } from "@/lib/types";

/**
 * UTF-8-safe base64 of a string.
 *
 * btoa() only accepts Latin-1; any non-ASCII character (accents, emoji, CJK,
 * smart quotes) would throw. We first percent-encode to ASCII via
 * encodeURIComponent, then turn each %XX escape back into its raw byte so btoa
 * sees a valid Latin-1 byte stream. This is the standard "unicode-safe btoa".
 */
function utf8ToBase64(str: string): string {
  const escaped = encodeURIComponent(str).replace(
    /%([0-9A-F]{2})/g,
    (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(escaped);
}

/** Inverse of utf8ToBase64: base64 -> original (possibly unicode) string. */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  // Re-build the %XX escape sequence from the raw bytes, then decode UTF-8.
  let escaped = "";
  for (let i = 0; i < binary.length; i++) {
    const code = binary.charCodeAt(i).toString(16).padStart(2, "0");
    escaped += `%${code}`;
  }
  return decodeURIComponent(escaped);
}

/** Standard base64 -> URL-safe base64 (no padding, +/ swapped for -_). */
function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** URL-safe base64 -> standard base64 (restore +/ and padding for atob). */
function fromUrlSafe(s: string): string {
  const restored = s.replace(/-/g, "+").replace(/_/g, "/");
  const padNeeded = (4 - (restored.length % 4)) % 4;
  return restored + "=".repeat(padNeeded);
}

/**
 * Encode a quiz into a compact, URL-safe string suitable for a "?q=" param.
 * The result contains the full quiz, so it is self-contained (no server needed).
 */
export function encodeQuizToParam(quiz: Quiz): string {
  const json = JSON.stringify(quiz);
  return toUrlSafe(utf8ToBase64(json));
}

/**
 * Decode a "?q=" param back into a Quiz.
 *
 * Returns null if the param is missing, not valid base64/JSON, or doesn't look
 * like a quiz (must have a string title and a non-empty questions array). This
 * lets callers show a friendly "invalid link" state instead of crashing.
 */
export function decodeQuizFromParam(param: string | null | undefined): Quiz | null {
  if (!param) return null;
  try {
    const json = base64ToUtf8(fromUrlSafe(param));
    const parsed = JSON.parse(json) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Quiz).title === "string" &&
      Array.isArray((parsed as Quiz).questions) &&
      (parsed as Quiz).questions.length > 0
    ) {
      return parsed as Quiz;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a full shareable URL for a quiz.
 *
 * @param quiz   The quiz to embed.
 * @param origin The site origin, e.g. window.location.origin ("https://app...").
 * @returns "<origin>/share?q=<encoded quiz>".
 */
export function buildShareUrl(quiz: Quiz, origin: string): string {
  const base = origin.replace(/\/+$/, ""); // drop any trailing slash
  return `${base}/share?q=${encodeQuizToParam(quiz)}`;
}
