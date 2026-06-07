/**
 * POST /api/youtube — fetch a YouTube video's transcript (captions) as plain text.
 *
 * WHAT THIS DOES
 * --------------
 * The browser sends us a YouTube URL. We pull that video's caption/transcript
 * text and return it as clean plain text. The /generate page then feeds that
 * text to the AI to build a quiz — exactly like it does for typed text, .txt,
 * .pdf, and .docx.
 *
 * WHY THIS IS A SERVER ROUTE (not done in the browser)
 * ----------------------------------------------------
 * YouTube's caption endpoints block cross-origin browser requests (CORS) and
 * sometimes refuse requests that don't look like they came from a normal
 * browser/app. Running this on the SERVER lets us:
 *   1. Avoid CORS entirely (server-to-server fetch has no CORS rules).
 *   2. Send a realistic User-Agent header so YouTube treats us like a client.
 *
 * ⚠️  MAINTENANCE WARNING — READ THIS
 * -----------------------------------
 * There is NO official, free, no-key YouTube transcript API. We use YouTube's
 * INTERNAL ("InnerTube") endpoints — the same private API the YouTube app uses.
 * These endpoints are UNDOCUMENTED and YouTube can change them at any time.
 * If transcripts suddenly stop working, this file is almost certainly why, and
 * it will need a small update (e.g. a new client version string, or a new way
 * to locate the caption track URL). That is expected and normal for this kind
 * of feature — it is the trade-off for being free and not adding a paid API.
 *
 * Sources this implementation is based on (all confirmed current as of 2026):
 *   - InnerTube /youtubei/v1/player approach + ANDROID client context:
 *     https://medium.com/@aqib-2/extract-youtube-transcripts-using-innertube-api-2025-javascript-guide-dc417b762f49
 *   - youtube-transcript-plus (GET watch page → POST player → GET transcript):
 *     https://github.com/ericmmartin/youtube-transcript-plus
 *   - Captions fetched as fmt=json3 (clean JSON instead of fragile XML):
 *     https://github.com/jdepoix/youtube-transcript-api
 *
 * CONTRACT
 *   Request body  : { url: string }
 *   Success (200) : { text: string, title?: string }
 *   Failure (400) : { error: string }  — a friendly message to show the user
 */

// Force the Node.js runtime (not Edge). We rely on a normal server `fetch`
// making outbound requests to youtube.com with custom headers; the Node runtime
// is the safe, predictable choice for that.
export const runtime = 'nodejs';

/**
 * Hard cap on returned characters. We mirror the MAX_CHARS value from
 * src/lib/extract.ts so YouTube transcripts obey the SAME limit as uploaded
 * files. (We redefine it here instead of importing because extract.ts is a
 * 'use client' module and this is a server route — keeping them separate avoids
 * pulling browser-only code into the server bundle. If you change one, change
 * both.)
 */
const MAX_CHARS = 100000;

/**
 * A realistic browser User-Agent. YouTube is more likely to serve captions to a
 * request that looks like a real browser than to a bare server fetch with no
 * User-Agent. This is a normal, current desktop Chrome string.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* -------------------------------------------------------------------------- */
/*  Route handler                                                              */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request): Promise<Response> {
  // --- 1. Read and validate the request body. ---
  // We wrap req.json() in try/catch because a malformed/empty body would throw.
  let url: unknown;
  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    return errorResponse('Invalid request. Please send a YouTube URL.');
  }

  if (typeof url !== 'string' || url.trim() === '') {
    return errorResponse('Please paste a YouTube link.');
  }

  // --- 2. Pull the 11-character video ID out of the URL. ---
  const videoId = extractVideoId(url.trim());
  if (!videoId) {
    return errorResponse(
      "That doesn't look like a valid YouTube link. Paste a URL like " +
        'https://www.youtube.com/watch?v=… or https://youtu.be/…',
    );
  }

  // --- 3. Fetch the transcript (primary method, then fallback). ---
  try {
    const { text, title } = await fetchTranscript(videoId);

    // No captions at all -> a clear, friendly error (this is the common case
    // for music videos, raw clips, or videos where the uploader disabled them).
    if (!text || text.trim().length === 0) {
      return errorResponse(
        "This video has no captions/transcript available, so it can't be " +
          'turned into a quiz. Try a video that has captions (most lectures, ' +
          'talks, and tutorials do), or paste the material as text instead.',
      );
    }

    // Clean up + enforce the character cap, then return.
    return Response.json({ text: normalizeAndCap(text), title });
  } catch (err) {
    // fetchTranscript throws friendly Error messages for the cases we know
    // about (no captions, restricted, fetch failure). Forward that message.
    const message =
      err instanceof Error
        ? err.message
        : 'Could not read this video. Please try a different one.';
    return errorResponse(message);
  }
}

/* -------------------------------------------------------------------------- */
/*  URL parsing → video ID                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extract the 11-character video ID from any common YouTube URL shape.
 *
 * Handles:
 *   - https://www.youtube.com/watch?v=VIDEOID        (standard)
 *   - https://m.youtube.com/watch?v=VIDEOID          (mobile web)
 *   - https://youtu.be/VIDEOID                        (short share link)
 *   - https://www.youtube.com/shorts/VIDEOID          (Shorts)
 *   - https://www.youtube.com/embed/VIDEOID           (embeds)
 *   - https://www.youtube.com/live/VIDEOID            (live)
 *   - a bare 11-char ID pasted on its own
 *
 * YouTube video IDs are always exactly 11 characters from the set
 * [A-Za-z0-9_-]. We use that fact to validate whatever we pull out.
 *
 * @returns the 11-char ID, or null if we can't find a valid one.
 */
function extractVideoId(input: string): string | null {
  // A YouTube ID is 11 chars of letters, digits, dash, underscore.
  const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

  // Case 0: the user pasted just the ID itself.
  if (ID_PATTERN.test(input)) return input;

  // Try to parse it as a URL. If it has no protocol, add one so `new URL`
  // (which requires a scheme like https://) doesn't throw.
  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  // Lower-case the host so "YouTube.com" matches too. Strip a leading "www." or
  // "m." so youtube.com, www.youtube.com and m.youtube.com all look the same.
  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');

  // --- youtu.be/VIDEOID  (the ID is the path) ---
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return ID_PATTERN.test(id) ? id : null;
  }

  // --- youtube.com (and youtube-nocookie.com for embeds) ---
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    // watch?v=VIDEOID — the ID is in the "v" query parameter.
    const vParam = parsed.searchParams.get('v');
    if (vParam && ID_PATTERN.test(vParam)) return vParam;

    // /shorts/VIDEOID, /embed/VIDEOID, /live/VIDEOID, /v/VIDEOID — the ID is the
    // path segment right after the keyword.
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const keyword = segments[0];
      const candidate = segments[1];
      if (
        (keyword === 'shorts' ||
          keyword === 'embed' ||
          keyword === 'live' ||
          keyword === 'v') &&
        ID_PATTERN.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Transcript fetching                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The shape of one caption track entry inside YouTube's player response. We only
 * type the fields we actually read. (`kind: 'asr'` marks auto-generated/speech
 * recognition captions; we prefer human-written ones when both exist.)
 */
interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

/**
 * Get the transcript text + title for a video.
 *
 * STRATEGY (primary + fallback, so one broken path doesn't kill the feature):
 *   1. PRIMARY  — InnerTube player API: POST /youtubei/v1/player with an ANDROID
 *      client context. This returns structured JSON that includes the list of
 *      caption tracks. This is the most reliable path in 2026 because the
 *      mobile/Android client is less aggressively gated than the web client.
 *   2. FALLBACK — Watch-page scrape: GET the normal watch page HTML and pull the
 *      embedded `captionTracks` JSON out of it. Used if the player API returns
 *      no usable tracks (YouTube sometimes serves them in only one of the two).
 *
 * Once we have a caption track URL from either path, we download the actual
 * caption text as `fmt=json3` (clean JSON) and join the segments.
 *
 * @throws friendly Error for: no captions, restricted video, or fetch failure.
 */
async function fetchTranscript(
  videoId: string,
): Promise<{ text: string; title?: string }> {
  // Try the primary (InnerTube) path first.
  let tracks: CaptionTrack[] = [];
  let title: string | undefined;

  try {
    const player = await fetchPlayerResponse(videoId);
    title = player.title;
    tracks = player.tracks;
  } catch {
    // Swallow and fall through to the watch-page fallback — we don't want a
    // single failed path to abort the whole request.
  }

  // If the player API gave us nothing usable, try scraping the watch page.
  if (tracks.length === 0) {
    const fallback = await fetchTracksFromWatchPage(videoId);
    tracks = fallback.tracks;
    // Only adopt the fallback title if we didn't already get one.
    title = title ?? fallback.title;
  }

  // Still nothing? Then this video genuinely has no captions we can read.
  if (tracks.length === 0) {
    throw new Error(
      "This video has no captions/transcript available, so it can't be " +
        'turned into a quiz. Try a video that has captions (most lectures, ' +
        'talks, and tutorials do), or paste the material as text instead.',
    );
  }

  // Choose the best track: prefer English, then any human-written track, then
  // whatever is first. (Auto-generated captions are fine as a last resort.)
  const track = pickBestTrack(tracks);

  // Download the caption text from the chosen track and return it.
  const text = await fetchCaptionText(track);
  return { text, title };
}

/**
 * PRIMARY PATH — call YouTube's internal player API.
 *
 * Endpoint: POST https://www.youtube.com/youtubei/v1/player
 * We send a JSON body with a `context.client` describing ourselves as the
 * ANDROID YouTube app. The response includes `captions.playerCaptionsTracklist
 * Renderer.captionTracks` (the list of caption tracks) and the video title.
 *
 * NOTE: the `clientVersion` below is a real Android app version string. If the
 * player API starts returning empty/odd responses, bumping this to a current
 * version is the first thing to try — YouTube occasionally rejects stale ones.
 */
async function fetchPlayerResponse(
  videoId: string,
): Promise<{ tracks: CaptionTrack[]; title?: string }> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      // Tells YouTube which internal client we are. Matches the ANDROID context
      // we send in the body; some endpoints cross-check this header.
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '20.10.38',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          // Android API level + a UA hint help the request look legitimate.
          androidSdkVersion: 30,
          hl: 'en',
        },
      },
      videoId,
    }),
  });

  if (!res.ok) {
    throw new Error(`player API responded ${res.status}`);
  }

  const data = await res.json();

  // If the video is private/removed/region-locked, YouTube reports it here.
  // `playabilityStatus.status` is 'OK' for playable videos; anything else
  // (LOGIN_REQUIRED, UNPLAYABLE, ERROR) means we can't read it.
  const status: string | undefined = data?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason: string =
      data?.playabilityStatus?.reason ||
      'This video is private, age/region restricted, or unavailable.';
    throw new Error(
      `Can't access this video: ${reason} Please try a different, ` +
        'publicly viewable video.',
    );
  }

  const title: string | undefined = data?.videoDetails?.title;

  const tracks: CaptionTrack[] =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return { tracks, title };
}

/**
 * FALLBACK PATH — scrape the normal watch page HTML.
 *
 * We GET https://www.youtube.com/watch?v=VIDEOID with a browser User-Agent.
 * The page embeds a big JSON blob (`ytInitialPlayerResponse`) that contains the
 * same `captionTracks` list. We pull that JSON out with a regex and parse it.
 *
 * This exists because the player API and the watch page don't always agree on
 * whether captions are available; having both paths makes the feature sturdier.
 */
async function fetchTracksFromWatchPage(
  videoId: string,
): Promise<{ tracks: CaptionTrack[]; title?: string }> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': USER_AGENT,
      // Asking for English avoids YouTube serving a consent/region interstitial
      // in another language that wouldn't contain the player JSON.
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(
      'Could not load this video from YouTube. It may be unavailable or ' +
        'restricted. Please try a different video.',
    );
  }

  const html = await res.text();

  // The watch page contains: ...ytInitialPlayerResponse = {…big JSON…};...
  // We grab everything from the opening "{" up to the terminating ";" that ends
  // the assignment. Two patterns cover the variations YouTube uses.
  // NOTE: we use `[\s\S]` (match ANY char incl. newlines) instead of `.` + the
  // `s`/dotAll flag, because the project's TS target is ES2017 which predates
  // that flag. `[\s\S]` is the portable equivalent.
  const match =
    html.match(
      /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>)/,
    ) || html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;/);

  if (!match) {
    // If we can't even find the player JSON, captions can't be located either.
    return { tracks: [] };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { tracks: [] };
  }

  // Walk the same paths the player API uses. We cast loosely because this is
  // untyped third-party JSON; we only read fields we then validate.
  const captions = (data as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } })
    .captions;
  const tracks: CaptionTrack[] =
    captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  const title = (data as { videoDetails?: { title?: string } }).videoDetails?.title;

  return { tracks, title };
}

/**
 * Pick the most useful caption track from the list.
 *
 * Order of preference:
 *   1. A human-written English track (languageCode starts with "en", not 'asr').
 *   2. Any human-written track (not auto-generated).
 *   3. Any English track (even auto-generated).
 *   4. The first track available.
 *
 * We prefer English because the quiz UI and AI prompts are English; we prefer
 * human-written because auto-generated captions have more errors.
 */
function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack {
  const isEnglish = (t: CaptionTrack) =>
    (t.languageCode ?? '').toLowerCase().startsWith('en');
  const isManual = (t: CaptionTrack) => t.kind !== 'asr';

  return (
    tracks.find((t) => isEnglish(t) && isManual(t)) ??
    tracks.find(isManual) ??
    tracks.find(isEnglish) ??
    tracks[0]
  );
}

/**
 * Download the actual caption text for one track and return it as plain text.
 *
 * We request the captions in `json3` format by adding `&fmt=json3` to the
 * track's baseUrl. json3 is YouTube's structured caption JSON — far easier and
 * sturdier to parse than the timestamped XML/SRV formats. Its shape is:
 *
 *   { events: [ { segs: [ { utf8: "some words" }, … ] }, … ] }
 *
 * We concatenate every `seg.utf8` from every event to rebuild the spoken text,
 * dropping the timing data entirely (we only want the words for a quiz).
 *
 * @throws a friendly Error if the caption download fails.
 */
async function fetchCaptionText(track: CaptionTrack): Promise<string> {
  // Start from the track's baseUrl, strip any existing &fmt=…, then force json3.
  const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
  const captionUrl = `${base}&fmt=json3`;

  const res = await fetch(captionUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(
      'Found captions but could not download them from YouTube. Please try ' +
        'again, or use a different video.',
    );
  }

  const body = await res.text();

  // Some tracks (rarely) return empty when fmt=json3 isn't supported. Treat an
  // empty body as "no usable captions" rather than crashing.
  if (!body.trim()) return '';

  let parsed: { events?: { segs?: { utf8?: string }[] }[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not json3 after all — give up on this track gracefully.
    return '';
  }

  const events = parsed.events ?? [];

  // Pull every text segment out of every event and join them into one string.
  // We add spaces between segments and trust normalizeAndCap to tidy spacing.
  const pieces: string[] = [];
  for (const event of events) {
    for (const seg of event.segs ?? []) {
      if (seg.utf8) pieces.push(seg.utf8);
    }
  }

  return pieces.join(' ');
}

/* -------------------------------------------------------------------------- */
/*  Text cleanup + safety cap                                                  */
/* -------------------------------------------------------------------------- */

/** A short note appended to text that had to be cut down to MAX_CHARS. */
const TRUNCATION_NOTE =
  '\n\n[Note: This transcript was longer than the supported limit and was ' +
  'truncated. Only the first part of the text is included.]';

/**
 * Turn raw caption segments into clean, quiz-ready plain text.
 *
 * Steps:
 *   1. Decode HTML entities (captions often contain &amp;#39; for an apostrophe,
 *      &amp; for "&", etc.) — we decode TWICE because YouTube double-encodes some.
 *   2. Collapse all runs of whitespace (including the newlines between segments)
 *      into single spaces. A transcript reads as one flowing block of text.
 *   3. Trim the ends.
 *   4. Enforce MAX_CHARS, appending the truncation note if we had to cut it.
 */
function normalizeAndCap(input: string): string {
  let text = decodeEntities(decodeEntities(input))
    // Collapse every whitespace run (spaces, tabs, newlines) to one space.
    .replace(/\s+/g, ' ')
    .trim();

  // Enforce the hard cap, reserving room so text + note never exceeds MAX_CHARS.
  if (text.length > MAX_CHARS) {
    const keep = MAX_CHARS - TRUNCATION_NOTE.length;
    text = text.slice(0, keep).trimEnd() + TRUNCATION_NOTE;
  }

  return text;
}

/**
 * Decode the HTML entities that show up in YouTube caption text.
 *
 * Covers the common named entities (&amp;, &lt;, &gt;, &quot;, &#39;) plus any
 * numeric entity in decimal (&#39;) or hexadecimal (&#x27;) form. We run this so
 * the AI sees "don't" instead of "don&#39;t".
 */
function decodeEntities(text: string): string {
  return (
    text
      // Numeric DECIMAL entities, e.g. &#39; -> '
      .replace(/&#(\d+);/g, (_m, dec: string) =>
        String.fromCodePoint(parseInt(dec, 10)),
      )
      // Numeric HEX entities, e.g. &#x27; -> '
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      // Named entities. &amp; is decoded LAST so we don't accidentally turn
      // "&amp;#39;" into "'" before the numeric pass above runs on it. (Because
      // normalizeAndCap calls this twice, double-encoding is handled either way.)
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Build a 400 JSON error response with a friendly message for the UI. */
function errorResponse(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
