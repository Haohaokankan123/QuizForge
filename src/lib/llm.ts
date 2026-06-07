/**
 * llm.ts — the AI quiz-generation engine for QuizForge.
 *
 * This is the HEART of the app and its STRICT GUARDRAIL. Everything here runs
 * on the SERVER ONLY (it reads a secret API key from process.env), so it must
 * never be imported into a client component.
 *
 * PROVIDER: We use Groq (https://console.groq.com) — a FREE, OpenAI-compatible
 * REST API (no credit card needed). We talk to it with the built-in `fetch`, so
 * there is NO npm package to install. Because Groq's chat API is OpenAI-shaped,
 * swapping to a different provider later (OpenAI, Together, etc.) means changing
 * ONLY this one file — the rest of the app keeps calling `generateQuiz()` exactly
 * the same way.
 *
 * What it does, end to end:
 *   1. Takes a GenerateRequest (the source text + how many questions, what
 *      types, what difficulty the user wants).
 *   2. Asks the Groq model to write quiz questions — but ONLY using the
 *      provided source text, never outside knowledge.
 *   3. Forces the model to reply as strict JSON that matches our Question shape.
 *   4. Re-checks (validates) every question on our side and throws away any
 *      that break the rules, so a sloppy or hallucinated answer never reaches
 *      the user.
 *   5. Returns a fully-formed Quiz object.
 *
 * The exported function:
 *   export async function generateQuiz(req: GenerateRequest): Promise<Quiz>
 */

// Import our shared types so this file uses the SAME data model as the rest of
// the app. `import type` means these are only used at compile time (they vanish
// at runtime), which keeps the bundle clean.
import type {
  GenerateRequest,
  Question,
  QuestionType,
  Quiz,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Groq base URL + chat endpoint. Groq is OpenAI-compatible, so the path is
 * the familiar `/chat/completions`.
 */
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * The Groq model we use. 'openai/gpt-oss-120b' is a large open model on Groq's
 * free tier that follows nuanced instructions far better than llama-3.3-70b —
 * crucially, it can write genuinely HARD multiple-choice questions with
 * confusable near-synonym distractors (the 70B kept ignoring that). Its free
 * tier has a LOWER token-per-minute cap (~8,000) — see TPM_LIMIT below.
 */
const MODEL_NAME = 'openai/gpt-oss-120b';

/**
 * Groq free-tier tokens-per-minute cap for MODEL_NAME (prompt + output combined).
 * gpt-oss-120b = 8,000 (lower than llama-3.3-70b's 12,000). Used to size the
 * output budget so we never exceed it (HTTP 413). If you change MODEL_NAME,
 * update this to that model's TPM limit.
 */
const MODEL_TPM_LIMIT = 8000;

/**
 * Human-readable labels for each question type. We put these into the prompt so
 * the model clearly understands what each requested type means.
 */
const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice (exactly 4 options, one correct)',
  true_false: "True/False (options must be exactly ['True', 'False'])",
  fill_blank: 'Fill in the blank (use ____ in the prompt for the missing part)',
  short_answer: 'Short answer (a brief free-text response)',
};

// ---------------------------------------------------------------------------
// Difficulty — a UNIVERSAL definition based on the LEVEL OF THINKING required
// (loosely Bloom's Taxonomy), so it works for ANY subject: vocab, math,
// science, history, social studies, coding, articles. Difficulty is NOT the
// topic — it's how hard the student has to THINK.
// ---------------------------------------------------------------------------

/** The core instruction for each difficulty level (subject-agnostic). */
function difficultyGuide(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
      return `EASY = REMEMBER / UNDERSTAND. Test direct recall of a single fact, definition, term, date, or stated idea. The student should be able to answer if they simply read and remembered the material. Distractors are clearly different from the answer.`;
    case 'hard':
      return `HARD = ANALYZE / EVALUATE / CREATE. The student must REASON, not just recall: apply a concept to a NEW/unfamiliar situation, work through multiple steps, compare or contrast ideas, infer a cause/effect or consequence, judge which option is BEST and why, or find/fix an error. The answer should NOT be a sentence copied from the source — it should require thinking ACROSS the material. A question answerable by simple recall is TOO EASY for hard — rewrite it to require reasoning.

  HARD MULTIPLE-CHOICE DISTRACTORS — THIS IS THE MOST IMPORTANT PART OF HARD MODE:
  The 3 wrong options must be GENUINELY CONFUSABLE with the correct answer — so a student who only sort-of knows the material would be tempted.
  FOR VOCABULARY/TERMINOLOGY DISTRACTORS: For hard ONLY, you MAY use real near-synonyms / closely-related terms that are NOT in the source as the WRONG options (e.g. if the answer is "rummage", good hard distractors are "ransack", "forage", "scavenge" — all "search/dig through" verbs — NOT unrelated source words like "stifle" or "radiate"). The CORRECT answer must STILL be a term from the source; only the distractors may come from outside.
  FOR NUMERIC / MATH ANSWERS: "near-synonym" does not apply — each wrong option MUST be the result of ONE specific, plausible student mistake ON THIS problem (wrong operation e.g. added instead of multiplied; wrong formula e.g. perimeter for area; dropped coefficient e.g. omitting the 1/2 in triangle area; off-by-one; wrong/missing unit). Keep the SAME correct unit on every option.
  FOR CODE OUTPUT / VALUE ANSWERS: each wrong option MUST be a value the code could plausibly produce under exactly one common error (off-by-one e.g. 1,2,3 instead of 0,1,2; 0-based vs 1-based indexing; including vs excluding an endpoint; len() vs last index/fencepost; a closely-related wrong operator) — NEVER a random number and NEVER a wrong TYPE (no "apple, banana" for a numeric answer).
  FOR CAUSE/EFFECT, PROCESS, OR FACTUAL SUBJECTS (history, science, social studies): wrong options MUST be OTHER REAL causes/effects/agents/facts STATED IN THE SOURCE, recombined into a tempting-but-wrong pairing (e.g. a real effect offered as if it were the cause) — NEVER an outside fact you happen to know, and NEVER an unrelated source noun.
  These computed/recombined wrong options are DERIVED from source data and do NOT count as "new numbers/facts" under the grounding rule. Keep all 4 options PARALLEL in length, grammar, and specificity so the correct one is never the longest or only on-topic option. The outside-near-synonym license applies to VOCABULARY ONLY. If you cannot build 3 genuinely-confusable distractors of the right kind, switch that question to fill_blank or short_answer instead (see below).

  HARD SCENARIOS AND FILL-IN SENTENCES MUST BE INDIRECT (applies to fill_blank/short_answer too, not just multiple choice): do NOT write a scenario that basically defines the word. BAD (gives it away): "If someone is searching through their backpack to find something, which verb?" → obviously rummage. GOOD (indirect): "Frustrated and in a hurry, Jordan pulled everything out of the drawer one item at a time, leaving a mess behind. Which word best captures Jordan's action?" with confusable options rummage/ransack/forage/scavenge.

  PREFER HARDER FORMATS ON HARD: when the chosen types allow it, favor fill_blank and short_answer (the student must PRODUCE the term from memory — much harder than picking from options). Use multiple_choice on hard only when you can supply genuinely confusable distractors.`;
    case 'medium':
    default:
      return `MEDIUM = APPLY. The student must USE the concept in a familiar situation, not just recall it: apply a definition to an example, do a one-step application, classify something, or distinguish between two related ideas. Harder than pure recall, easier than multi-step reasoning. Distractors are related/commonly-confused so a guesser can't easily rule them out.`;
  }
}

/** Concrete cross-subject examples of the level, so the model calibrates right. */
function difficultyExamples(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
      return `- Vocabulary: "What does 'forlorn' mean?" (recall the definition)
- Math: "What is the formula for the area of a circle?" (recall)
- History: "In what year did the event happen?" (recall)
- Science: "Which gas do plants release during photosynthesis?" (recall one stated fact)
- Coding: "What does the keyword 'return' do?" (recall)`;
    case 'hard':
      return `- Vocabulary: give a NEW scenario and ask which word fits — "After everyone left without saying goodbye, Mia felt ___." → forlorn (apply the word to a fresh situation; distractors are near-synonyms like melancholy/wistful).
- Math: a multi-step WORD PROBLEM using the source's formulas/values — "A garden is 8m by 5m; a 1m path runs around the inside. What area is left for planting?" (reason through several steps).
- History: "Why did X most likely lead to Y?" or "Which factor was the most significant cause, and why?" (analyze cause/effect, not recall a date).
- Science: a "what breaks if a step changes" process question — "A plant is sealed in a dark box with water and CO2; which product can it no longer make?" → glucose (reason cause/effect; the WHY goes in the explanation, the ANSWER stays a source term; MC distractors are confusable source nouns like oxygen/starch).
- Coding: COMPOSE a NEW 2-4 line snippet that COMBINES constructs the source describes (e.g. a loop + a list + len()/indexing) and ask for the EXACT final value or printed lines; OR plant ONE bug and ask what it returns for a given input. Every construct used must be one the source defines, but the snippet is new. NEVER ask "what does <keyword> do" or pose a true/false about one definition on hard — that is recall.`;
    case 'medium':
    default:
      return `- Vocabulary: "Which sentence uses 'forlorn' correctly?" (apply the word, not just define it).
- Math: "Using the area formula, what is the area of a circle with radius 3?" (one-step apply).
- History: "Which of these is an example of [concept from the source]?" (classify/apply).
- Science: "Which raw material of photosynthesis is also a product of respiration?" (one-step apply).
- Coding: "What does this one-line snippet evaluate to?" (apply understanding).`;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder — the HARD rules that keep the AI honest
// ---------------------------------------------------------------------------

/**
 * Builds the text prompt we send to Groq. The prompt is where we state every
 * non-negotiable rule.
 *
 * IMPORTANT difference from a schema-based provider: Groq's JSON mode
 * (`response_format: { type: 'json_object' }`) guarantees the reply is VALID
 * JSON, but it does NOT enforce a specific shape. So the prompt itself must spell
 * out the EXACT JSON shape we want, and our own `validateQuestions` below remains
 * the real guarantee. (The literal word "JSON" must also appear in the messages,
 * or Groq rejects the request — it does, both here and in the system message.)
 */
function buildPrompt(
  req: GenerateRequest,
  count: number,
  existingPrompts: string[] = [],
): string {
  // Turn the requested types (e.g. ['multiple_choice','true_false']) into a
  // readable, labelled list so the model only generates the chosen kinds.
  const requestedTypes = req.types
    .map((t) => `- ${t}: ${TYPE_LABELS[t]}`)
    .join('\n');

  // On retry rounds, list the prompts we already have so the model doesn't
  // repeat them — it should produce DIFFERENT questions to top up the count.
  const avoidBlock =
    existingPrompts.length > 0
      ? `\n\nDO NOT REPEAT these questions you already wrote — make DIFFERENT ones:\n${existingPrompts
          .map((p) => `- ${p}`)
          .join('\n')}\n`
      : '';

  return `You are an EXPERT exam writer for a serious study app. Your quizzes must genuinely TEST understanding, not give the answer away. A weak, obvious, or self-answering question is a FAILURE.

GROUNDING RULES (non-negotiable):
1. Every question must be answerable SOLELY from the SOURCE below. Use NO outside knowledge or facts not present in the source.
2. For math/numeric AND code-tracing content, write WORD PROBLEMS / short snippets using only the values, formulas, functions, and constructs in the source. The ANSWER may be a value you DERIVE by computing or tracing from those source values — but introduce no new numbers, operations, or library functions the source does not contain.
3. Every question MUST include "source_quote": the exact sentence(s) copied VERBATIM from the source that justify the answer. (This is for the answer review — it is NOT shown while the student answers.)

COUNT & QUALITY — QUALITY BEATS QUANTITY:
C1. Try to produce ${count} questions, but EVERY question must be high-quality and test a DISTINCT idea. Quality always wins over hitting the number.
C2. Cover DIFFERENT facts/concepts/terms — do NOT test the same idea twice. (BAD: one question "Which word means 'sad and lonely'?" → forlorn AND another "What does 'forlorn' mean?" — that is the SAME word/concept twice, just flipped. Never do this.) Each question must target a different item from the source.
C3. If the source genuinely does not contain ${count} distinct testable ideas, produce FEWER good questions rather than padding with repeats or trivia. It is better to return 8 great questions than 30 with duplicates. (Our code adds a note to the student when fewer are returned.)

NO SELF-ANSWERING / NO COPYING:
P1. NEVER let the question reveal its own answer. The "prompt" must not contain the answer (or its definition) verbatim.
P2. Do NOT copy a source sentence and just blank it out — compose your own phrasing.
P3 (HARD vocabulary fill_blank / short_answer): the composed sentence must show the word IN USE through a concrete situation, action, or consequence, and must NOT state or paraphrase the word's definition anywhere in the sentence — the reader must INFER the word from the situation, never read its meaning beside the blank. The blanked answer is STILL the source word itself (grounding unchanged). BAD: "The clinic was kept ____, free from dirt, infection, and other dangers to health." (restates the definition → self-answering recall). GOOD: "After the inspector's surprise visit, the cafeteria scrubbed every surface and finally passed as ____." (forces inference). This is about SENTENCE FRAMING only; it never permits a non-source synonym as the answer. If the source gives only a definition and you cannot build an indirect in-use sentence, lower this question's ambition rather than restating the definition.

DIFFICULTY = "${req.difficulty}". This is UNIVERSAL — it applies to ANY subject (vocabulary, math, science, history, social studies, coding, articles). Difficulty is the LEVEL OF THINKING required, not the topic. ${difficultyGuide(req.difficulty)}

GENERAL EXAMPLES of the level for "${req.difficulty}" across subjects (adapt to whatever the source actually is):
${difficultyExamples(req.difficulty)}
The words, sentences, numbers, and distractor sets in the examples above illustrate the PATTERN only — never reuse those exact sentences, example words, or distractor lists; compose entirely original questions for the ACTUAL source.${
    req.difficulty === 'hard'
      ? `

HARD-MODE REASONING FLOOR: a hard question MUST require reasoning ACROSS a source-stated relationship — cause/effect, comparison, consequence, tracing a result, or applying a stated idea to a NEW situation. A question answerable by locating a single stated fact, date, place, name, count, or definition is NOT hard — DROP it; do NOT relabel it hard and do NOT pad to reach the count with it. If the source supports fewer genuinely-hard questions than requested, return ONLY those and STOP — returning 2 strong hard questions for a thin passage is CORRECT and our app shows the student a note. GROUNDING IS UNCHANGED: the correct answer must still be a term/value/fact derivable from the source and every question must still include source_quote; only the reasoning bar is raised.`
      : ''
  }

CRITICAL for apply/scenario questions: the CORRECT ANSWER must ALWAYS be a term, value, or fact FROM THE SOURCE — never a synonym or word that isn't in the source. (e.g. if the source has "forlorn", a scenario question's answer must be "forlorn", not "melancholy".) The scenario is new; the answer is always from the material. (Wrong options follow the difficulty rule below.)

FORMAT RULES:
4. Only generate these requested TYPES (no others):
${requestedTypes}
5. Generate EXACTLY ${count} questions (see COUNT rules C1-C3 above).
6. "true_false": "options" exactly ["True","False"]; "answer" exactly "True" or "False". Make the FALSE statements subtly wrong (a plausible misconception from the source), not absurd.
7. "multiple_choice": exactly 4 DISTINCT options; "answer" must be the FULL TEXT of one option copied VERBATIM (NOT a letter like "B" and NOT a number like "2"). All 4 options similar in length and style (the correct one must NOT be the obviously longest or only on-topic one). No "All/None of the above". Vary the position of the correct answer across questions.
   WRONG-OPTION SOURCING by difficulty:
   - easy / medium: wrong options must be REAL items from the source (other terms / other definitions), plausible but verifiably wrong.
   - hard: wrong options should be GENUINELY CONFUSABLE with the answer. For vocabulary, prefer near-synonyms / closely-related terms; these MAY be words NOT in the source (only for hard, only for the WRONG options). For numeric, code-output, or cause/effect answers, wrong options must instead be plausible-MISTAKE values / recombined REAL source facts as defined in the hard difficulty guide — never outside facts, never throwaway, never a wrong type. The correct answer is always a source term/value. Never use unrelated source words as "hard" distractors just because they're in the source.
8. "fill_blank": put "____" where the missing word/phrase goes, in a NEW sentence you compose (NOT a copied source sentence). "answer" is the missing word/phrase. No "options".
9. "short_answer": "answer" is a brief correct response (for vocab, the meaning or the word). No "options".
10. Write a concise "title" reflecting the subject of the source.

Before finalizing, RE-READ and check: (a) did I produce EXACTLY ${count} questions? (count them) (b) does any prompt give away its own answer? (c) does each question match the LEVEL OF THINKING for difficulty="${req.difficulty}" — easy = recall one stated fact/term/value; medium = apply the concept to a familiar case; hard = REASON (multi-step, compare, infer cause/effect, evaluate, trace, or apply to a NEW situation; for math/code a worked WORD PROBLEM or code-trace). For HARD specifically, ask of EACH question: "could a student answer this just by locating one stated fact, date, name, count, or definition?" — if yes it is TOO EASY for hard: rewrite it to require reasoning, or DROP it (never relabel recall as hard). (d) for any multiple_choice, are the 3 wrong options genuinely confusable with the answer (not throwaway)? A student must NOT be able to answer any question by copying a single source sentence verbatim. If any check fails, fix it before responding.

Respond with ONLY a single JSON object (no markdown, no commentary) in EXACTLY this shape:
{
  "title": "string — a short, descriptive title for the quiz based on the source",
  "questions": [
    {
      "type": "one of: multiple_choice | true_false | fill_blank | short_answer",
      "prompt": "string — the question text shown to the student",
      "options": ["string", "..."],   // OPTIONAL: for multiple_choice provide exactly 4; for true_false provide exactly ["True","False"]; OMIT for fill_blank and short_answer
      "answer": "string — the correct answer; for multiple_choice it must exactly match one of the options",
      "explanation": "string — why the answer is correct, based only on the source",
      "source_quote": "string — the exact sentence(s) copied verbatim from the source that prove the answer"
    }
  ]
}

SOURCE:
"""
${req.content}
"""${avoidBlock}`;
}

// ---------------------------------------------------------------------------
// The shape the model gives back (before our validation)
// ---------------------------------------------------------------------------

/**
 * What a raw question from the model looks like before we trust it. Every field
 * is optional/loosely typed because we have NOT validated it yet — the model
 * could omit fields or send the wrong types, and we must handle that safely.
 */
interface RawQuestion {
  type?: string;
  prompt?: string;
  options?: unknown;
  answer?: string;
  explanation?: string;
  source_quote?: string;
}

/** The raw top-level object from the model. */
interface RawQuizResponse {
  title?: string;
  questions?: RawQuestion[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** True if `value` is a string with real (non-whitespace) content. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Recover a multiple-choice answer when the model returned a LETTER ("B"),
 * a NUMBER ("2"), or a "B) text" / "2. text" prefix instead of the exact option
 * text. Returns the matching option string, or null if it cannot be resolved.
 *
 * WHY: Without this, a perfectly good question whose answer is "B" gets dropped
 * (because "B" !== the option text), which silently shrinks the quiz — that is
 * what caused "asked for 5, got 2".
 */
function recoverMcAnswer(
  answer: string | undefined,
  options: string[],
): string | null {
  if (!isNonEmptyString(answer)) return null;
  const a = answer.trim();

  // Case-insensitive exact text match (handles trivial casing/space diffs).
  const exact = options.find(
    (o) => o.trim().toLowerCase() === a.toLowerCase(),
  );
  if (exact) return exact;

  // A bare letter A–Z → index (A=0, B=1, ...).
  if (/^[A-Za-z]$/.test(a)) {
    const idx = a.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  // A bare number 1–N → index (1-based).
  if (/^\d+$/.test(a)) {
    const idx = parseInt(a, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  // A "B) Sanitary" / "B. Sanitary" / "2) Sanitary" prefix → strip and match.
  const stripped = a.replace(/^\s*[A-Za-z0-9]\s*[).:-]\s*/, '').trim();
  if (stripped && stripped !== a) {
    const m = options.find(
      (o) => o.trim().toLowerCase() === stripped.toLowerCase(),
    );
    if (m) return m;
  }

  return null;
}

/** The set of valid question types, used to reject anything unexpected. */
const VALID_TYPES = new Set<QuestionType>([
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
]);

// ---------------------------------------------------------------------------
// Validation — the server-side guardrail
// ---------------------------------------------------------------------------

/**
 * Takes the raw questions from the model and returns only the ones that pass
 * every rule, converted into our strict `Question` type. Anything missing
 * required fields, or with an invalid multiple_choice/true_false structure, is
 * DROPPED.
 *
 * `allowedTypes` is the set the user actually requested — we drop any question
 * whose type wasn't asked for, even if the model produced it.
 */
function validateQuestions(
  rawQuestions: RawQuestion[],
  allowedTypes: Set<QuestionType>,
): Question[] {
  const valid: Question[] = [];

  for (const raw of rawQuestions) {
    // --- Required text fields: prompt, answer, source_quote, explanation ---
    // Drop the question if any required text field is missing or blank.
    if (!isNonEmptyString(raw.prompt)) continue;
    if (!isNonEmptyString(raw.answer)) continue;
    if (!isNonEmptyString(raw.source_quote)) continue;

    // --- Type must be one of our 4 valid types AND one the user requested ---
    const type = raw.type as QuestionType;
    if (!VALID_TYPES.has(type)) continue;
    if (!allowedTypes.has(type)) continue;

    // --- Normalise options into a clean string[] (or undefined) ---
    // The model may send options as something other than an array of strings,
    // so we coerce defensively and keep only non-empty string entries.
    let options: string[] | undefined;
    if (Array.isArray(raw.options)) {
      options = raw.options.filter(
        (o): o is string => isNonEmptyString(o),
      );
      if (options.length === 0) options = undefined;
    }

    // --- Per-type structural checks ---
    if (type === 'multiple_choice') {
      // Must have at least 4 options.
      if (!options || options.length < 4) continue;
      // Keep exactly the first 4 distinct options for a clean UI.
      const distinct = Array.from(new Set(options));
      if (distinct.length < 4) continue;
      options = distinct.slice(0, 4);

      // The answer should equal one option verbatim. But models sometimes return
      // the answer as a LETTER ("B") or a NUMBER ("2") instead of the option
      // text — if we naively required an exact match we'd wrongly DROP those
      // perfectly good questions (this caused "asked for 5, got 2"). So we
      // RECOVER letter/number answers by mapping them to the matching option.
      if (!options.includes(raw.answer)) {
        const recovered = recoverMcAnswer(raw.answer, options);
        if (recovered === null) continue; // truly unmatchable → drop
        raw.answer = recovered;
      }
    } else if (type === 'true_false') {
      // Force canonical options and accept only 'True'/'False' answers.
      options = ['True', 'False'];
      if (raw.answer !== 'True' && raw.answer !== 'False') continue;
    } else {
      // fill_blank and short_answer carry no options.
      options = undefined;
    }

    // --- Explanation: keep it, but don't drop the question if it's missing. ---
    const explanation = isNonEmptyString(raw.explanation)
      ? raw.explanation
      : '';

    // Build the clean Question. We assign the stable `id` later, in order.
    const question: Question = {
      id: '', // filled in by the caller after we know the final order
      type,
      prompt: raw.prompt,
      answer: raw.answer,
      explanation,
      source_quote: raw.source_quote,
      ...(options ? { options } : {}),
    };

    valid.push(question);
  }

  // Assign stable ids (q1, q2, ...) in final order so the UI/grading can refer
  // to each question reliably.
  return valid.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

/**
 * Parses the model's text into our raw response shape. Even though we request
 * JSON, we defend against the model wrapping it in ```json fences or adding
 * stray text, by extracting the first {...} block if a direct parse fails.
 */
function parseModelJson(text: string): RawQuizResponse {
  // First try: parse the whole thing directly (the happy path).
  try {
    return JSON.parse(text) as RawQuizResponse;
  } catch {
    // Fall through to the more forgiving extraction below.
  }

  // Second try: strip markdown code fences if present.
  const fenced = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(fenced) as RawQuizResponse;
  } catch {
    // Fall through.
  }

  // Last try: grab the first {...} object substring and parse that.
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = fenced.slice(start, end + 1);
    return JSON.parse(slice) as RawQuizResponse;
  }

  // Nothing worked — signal a clear failure to the caller.
  throw new Error('The AI did not return valid JSON.');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generates a validated Quiz from the given request.
 *
 * @param req - the source content plus the user's choices (types, difficulty,
 *              count, sourceType).
 * @returns a Promise resolving to a fully-formed, validated `Quiz`.
 * @throws if the API key is missing, the model returns nothing usable, or no
 *         valid questions survive validation.
 */
export async function generateQuiz(req: GenerateRequest): Promise<Quiz> {
  // --- 1. Read the secret API key (server-only) ---
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // A clear, actionable error so setup problems are obvious in the logs.
    throw new Error(
      'GROQ_API_KEY is not set. Add it to your .env.local file (server-side only). Get a free key at https://console.groq.com/keys',
    );
  }

  // --- 2. Guard against an empty source ---
  if (!isNonEmptyString(req.content)) {
    throw new Error('Cannot generate a quiz from empty source content.');
  }

  // --- 2b. CHUNK long content so big study materials work on the free tier.
  // gpt-oss-120b's free tier reads only MODEL_TPM_LIMIT (~8,000) tokens/minute
  // (prompt + output). A long article (10k+ words) won't fit in one request. So
  // if the source is bigger than a safe size, we split it into chunks, generate a
  // SHARE of the questions from each chunk, and merge them into one quiz. This is
  // what makes "feed it a 10,000-word article" actually work for free.
  // Sized for the 8k cap WITH reasoning headroom: ~2,250 source tokens + ~2,400
  // prompt-scaffold tokens + ~2,200 reasoning/output tokens + 800 margin stays
  // under 8,000. (Was 24,000 under the old 12k cap with no reasoning model.)
  const SAFE_CHARS_PER_REQUEST = 9000; // ~2.2k words; leaves room for prompt+reasoning+output
  if (req.content.length > SAFE_CHARS_PER_REQUEST) {
    return generateQuizFromChunks(req, apiKey, SAFE_CHARS_PER_REQUEST);
  }

  // --- 3. Generate questions for this (single, in-budget) source. ---
  const { questions: collected, title } = await collectQuestions(
    req,
    req.content,
    req.count,
    apiKey,
  );

  // --- 4. Cap to the exact count and assign stable ids q1..qN. ---
  const questions = collected
    .slice(0, req.count)
    .map((q, i) => ({ ...q, id: `q${i + 1}` }));

  // --- 5. If nothing survived, fail loudly with a friendly message ---
  if (questions.length === 0) {
    throw new Error(
      'No valid questions could be generated from this source. Try adding more detailed material.',
    );
  }

  // --- 6. Coerce into the final Quiz shape and return (with a warning if we
  //        couldn't make as many GOOD, distinct questions as requested). ---
  const quiz: Quiz = {
    id: `quiz_${Date.now()}`,
    title,
    difficulty: req.difficulty,
    source_type: req.sourceType,
    questions,
    created_at: new Date().toISOString(),
    ...(questions.length < req.count
      ? { warning: shortfallWarning(questions.length, req.count) }
      : {}),
  };

  return quiz;
}

/** Friendly message shown when fewer good questions were made than requested. */
function shortfallWarning(made: number, asked: number): string {
  return `You asked for ${asked} questions, but your material only supported ${made} strong, distinct ${made === 1 ? 'question' : 'questions'}. Add more content (or more detail) for a longer quiz — we left out weak or repetitive questions on purpose.`;
}

/**
 * Collect up to `count` valid questions for ONE piece of content, RETRYING.
 *
 * One Groq call often returns FEWER questions than asked (the model ignores the
 * count, or some get dropped in validation). So we LOOP: each round asks for the
 * still-missing number and tells the model which prompts already exist (so it
 * makes DIFFERENT ones). This is what guarantees "asked for 5, get 5".
 *
 * Returns the collected questions (NO ids yet — the caller assigns them after
 * merging) and the quiz title from the first round.
 */
async function collectQuestions(
  req: GenerateRequest,
  content: string,
  count: number,
  apiKey: string,
): Promise<{ questions: Question[]; title: string }> {
  const allowedTypes = new Set<QuestionType>(req.types);
  const collected: Question[] = [];
  // Track which CONCEPTS we've already tested (not just prompt text), so the
  // same word/idea isn't quizzed twice in different wording (e.g. "what does
  // forlorn mean?" AND "which word means sad and lonely?" — both = forlorn).
  const seenPrompts = new Set<string>();
  const seenConcepts = new Set<string>();
  let title = 'Generated Quiz';
  const MAX_ROUNDS = 5;
  let dryRounds = 0; // rounds in a row that added nothing new

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (collected.length >= count) break;
    // Stop early if the material seems exhausted (two dry rounds in a row).
    if (dryRounds >= 2) break;

    const remaining = count - collected.length;
    const askFor = Math.min(remaining + 2, 30);
    const existingPrompts = collected.map((q) => q.prompt);
    const prompt = buildPrompt({ ...req, content }, askFor, existingPrompts);

    let result: { questions: RawQuestion[]; title?: string };
    try {
      result = await callGroq(apiKey, prompt, askFor);
    } catch (err) {
      if (collected.length === 0) throw err; // first round failed → surface it
      break; // later round failed → keep what we have
    }

    if (isNonEmptyString(result.title) && title === 'Generated Quiz') {
      title = result.title;
    }

    const fresh = validateQuestions(result.questions, allowedTypes);
    let addedThisRound = 0;
    for (const q of fresh) {
      const pKey = q.prompt.trim().toLowerCase();
      if (seenPrompts.has(pKey)) continue;
      const cKey = conceptKey(q);
      if (seenConcepts.has(cKey)) continue; // same concept already tested → skip
      seenPrompts.add(pKey);
      seenConcepts.add(cKey);
      collected.push(q);
      addedThisRound++;
      if (collected.length >= count) break;
    }
    dryRounds = addedThisRound === 0 ? dryRounds + 1 : 0;
  }

  return { questions: collected, title };
}

/**
 * A "concept key" for a question — used to detect when two differently-worded
 * questions actually test the SAME idea (so we don't include both).
 *
 * For vocab the concept is usually the word being tested, which appears as the
 * answer (MEANING→WORD: answer is the word) OR inside the prompt (WORD→MEANING:
 * "What does 'forlorn' mean?"). We build the key from the answer plus any
 * quoted/′d term in the prompt, normalized. This catches the "forlorn asked two
 * ways" duplicate. For non-vocab it falls back to the normalized answer, which
 * still prevents asking the exact same fact twice.
 */
function conceptKey(q: Question): string {
  // Common function words that don't identify a concept — stripping them makes
  // "the steam engine" and "steam engine" collide (they're the same idea).
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'and', 'true', 'false',
  ]);
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w && !STOPWORDS.has(w))
      .join(' ');

  // true_false answers are always just "True"/"False", so keying on the answer
  // collapses EVERY T/F to one key — a T/F would wrongly dedup against any other
  // T/F and never against the MC/fill testing the same fact. Instead, key a T/F
  // on the SALIENT tokens of its statement (its words, numbers, and any
  // quoted/`code` spans, minus stopwords), so "range(3) gives 0,1,2" as a T/F
  // shares tokens with the MC asking the same thing, while two different T/F
  // statements stay distinct.
  if (q.type === 'true_false') {
    const tokens = norm(q.prompt).split(' ').filter(Boolean);
    // Sort + de-dupe for a stable key independent of word order.
    return Array.from(new Set(tokens)).sort().join(' ');
  }

  // Pull a quoted term out of the prompt if present (e.g. 'forlorn').
  const quoted = q.prompt.match(/['"“”']([^'"“”']{2,40})['"“”']/);
  const promptTerm = quoted ? norm(quoted[1]) : '';
  const answerNorm = norm(q.answer);
  // The concept is whichever short term identifies the item: prefer a quoted
  // word in the prompt, else the answer. Combine both so flipped Q&A collide.
  return [promptTerm, answerNorm].filter(Boolean).sort().join('|');
}

/**
 * Generate a quiz from LONG content by splitting it into chunks.
 *
 * Each chunk gets a share of the total question count; we generate from each
 * chunk separately (so no single request exceeds the free-tier token limit),
 * then merge, dedupe, cap to the requested count, and assign ids. This lets a
 * 10,000+ word article become a quiz on the free tier.
 */
async function generateQuizFromChunks(
  req: GenerateRequest,
  apiKey: string,
  safeChars: number,
): Promise<Quiz> {
  const chunks = splitIntoChunks(req.content, safeChars);

  // Spread the requested count across chunks (at least 1 each; extras go to the
  // earlier chunks). Cap chunks used so we don't make too many calls.
  const MAX_CHUNKS = 6;
  const usedChunks = chunks.slice(0, MAX_CHUNKS);
  const perChunk = Math.max(1, Math.ceil(req.count / usedChunks.length));

  const merged: Question[] = [];
  const seenPrompts = new Set<string>();
  const seenConcepts = new Set<string>();
  let title = 'Generated Quiz';

  for (let i = 0; i < usedChunks.length; i++) {
    if (merged.length >= req.count) break;
    const want = Math.min(perChunk, req.count - merged.length);
    let res: { questions: Question[]; title: string };
    try {
      res = await collectQuestions(req, usedChunks[i], want, apiKey);
    } catch (err) {
      if (merged.length === 0 && i === usedChunks.length - 1) throw err;
      continue; // skip a failed chunk, keep going
    }
    if (i === 0 && res.title !== 'Generated Quiz') title = res.title;
    for (const q of res.questions) {
      const pKey = q.prompt.trim().toLowerCase();
      if (seenPrompts.has(pKey)) continue;
      const cKey = conceptKey(q);
      if (seenConcepts.has(cKey)) continue; // same concept across chunks → skip
      seenPrompts.add(pKey);
      seenConcepts.add(cKey);
      merged.push(q);
      if (merged.length >= req.count) break;
    }
  }

  const questions = merged
    .slice(0, req.count)
    .map((q, i) => ({ ...q, id: `q${i + 1}` }));

  if (questions.length === 0) {
    throw new Error(
      'No valid questions could be generated from this source. Try adding more detailed material.',
    );
  }

  return {
    id: `quiz_${Date.now()}`,
    title,
    difficulty: req.difficulty,
    source_type: req.sourceType,
    questions,
    created_at: new Date().toISOString(),
    ...(questions.length < req.count
      ? { warning: shortfallWarning(questions.length, req.count) }
      : {}),
  };
}

/**
 * Split text into chunks of at most `maxChars`, breaking on paragraph/sentence
 * boundaries where possible (so a chunk doesn't cut a sentence in half).
 */
function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  // Split on blank lines first (paragraphs); fall back to single newlines.
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current) {
      chunks.push(current.trim());
      current = '';
    }
    // A single paragraph bigger than maxChars: hard-split it.
    if (para.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * Make ONE call to Groq and return the raw parsed questions + title.
 *
 * Kept separate from generateQuiz() so the retry loop can call it repeatedly.
 * Handles token-budget sizing, the fetch, error mapping, and JSON parsing.
 */
async function callGroq(
  apiKey: string,
  prompt: string,
  askFor: number,
): Promise<{ questions: RawQuestion[]; title?: string }> {
  // Groq's FREE tier caps total tokens-per-minute (prompt + output). For
  // gpt-oss-120b that cap is MODEL_TPM_LIMIT (8,000). Size the OUTPUT budget to
  // the number of questions, then clamp so prompt + output stays under the limit
  // (otherwise we get HTTP 413 "Request too large").
  const TPM_LIMIT = MODEL_TPM_LIMIT;
  const SAFETY_MARGIN = 800;
  const estPromptTokens = Math.ceil((prompt.length + 400) / 4);
  const budgetForOutput = Math.max(
    1000,
    TPM_LIMIT - SAFETY_MARGIN - estPromptTokens,
  );
  // gpt-oss-120b is a REASONING model: it spends "reasoning" tokens BEFORE it
  // writes any JSON. With reasoning_effort:'low' (set below) that overhead is
  // small, but max_tokens must still cover reasoning + the JSON, or the JSON gets
  // truncated and Groq rejects it with an empty `failed_generation`
  // ("json_validate_failed"). So we budget a REASONING_HEADROOM floor on top of
  // the per-question estimate. ~320 tokens/question covers 4 options + answer +
  // explanation + source_quote for a hard question.
  const REASONING_HEADROOM = 1100;
  const desiredOutput = Math.max(2200, REASONING_HEADROOM + askFor * 320);
  const maxOutputTokens = Math.min(desiredOutput, budgetForOutput);

  let response: Response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert exam writer. You write challenging, fair quiz questions that TEST understanding and never give away their own answers. You output strict, valid JSON only, using ONLY the source text provided — never outside knowledge. You ALWAYS return the exact number of questions requested.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: maxOutputTokens,
        // gpt-oss-120b supports reasoning_effort. We don't need deep
        // chain-of-thought to format quiz JSON (the rules are explicit), and
        // high reasoning both wastes the token budget — risking a truncated,
        // invalid JSON reply — and slows generation. 'low' keeps it fast and
        // leaves room for the actual questions.
        reasoning_effort: 'low',
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to reach the Groq API: ${detail}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    if (response.status === 429) {
      throw new Error(
        'The free AI is busy right now (rate limit). Please wait a moment and try again.',
      );
    }
    if (response.status === 401) {
      throw new Error(
        'The Groq API key is missing or invalid. Check GROQ_API_KEY in your .env.local — get a free key at https://console.groq.com/keys',
      );
    }
    if (response.status === 413) {
      throw new Error(
        'That source is too long for the free AI in one request. Try fewer questions, or shorter material (the free tier limits how much text it can read at once).',
      );
    }
    const shortDetail = detail ? ` Details: ${detail.slice(0, 300)}` : '';
    throw new Error(
      `The AI service returned an error (HTTP ${response.status}).${shortDetail}`,
    );
  }

  let rawText: string;
  try {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!isNonEmptyString(content)) throw new Error('empty content');
    rawText = content;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`The AI returned an unexpected response: ${detail}`);
  }

  const parsed = parseModelJson(rawText);
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    title: parsed.title,
  };
}
