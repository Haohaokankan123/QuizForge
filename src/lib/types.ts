/**
 * Shared TypeScript types for QuizForge.
 *
 * This file is the single source of truth for quiz-related shapes and MUST be
 * imported everywhere (API routes, components, lib helpers) so the data model
 * stays consistent across the app. Import via the "@/lib/types" alias.
 */

/**
 * The kind of question a quiz item is.
 * - 'multiple_choice': choose one option from `Question.options`
 * - 'true_false': options are exactly ['True', 'False']
 * - 'fill_blank': type the missing word/phrase
 * - 'short_answer': type a brief free-text answer
 */
export type QuestionType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer';

/** How challenging the quiz is. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Where the quiz content came from.
 * - text/txt/pdf/docx/youtube: real study material the user provided (STRICT
 *   grounding — questions use ONLY this content).
 * - 'ai': the user described a topic; the AI may use its OWN knowledge (blended
 *   with any optional notes). Grounding is relaxed for this source only.
 * - 'photo': text was read from a photo (camera/upload) via a vision model, then
 *   treated like any other source.
 */
export type SourceType = 'text' | 'txt' | 'pdf' | 'docx' | 'youtube' | 'ai' | 'photo';

/**
 * How questions are PHRASED (independent of difficulty).
 * - straightforward: clear, direct questions.
 * - tricky: exam-style with subtle, plausible traps in the wrong options.
 * - real_world: applied scenarios / situations.
 * - quick_recall: short, fast recall prompts.
 */
export type QuizStyle = 'straightforward' | 'tricky' | 'real_world' | 'quick_recall';

/**
 * How the quiz is PLAYED.
 * - exam: answers hidden until the end; free back-navigation; graded at Finish.
 * - practice: instant correct/wrong + explanation after each question.
 * - adaptive: instant feedback, no back-nav; difficulty ramps with performance.
 */
export type QuizMode = 'exam' | 'practice' | 'adaptive';

/** How the timer is configured when timed mode is on. */
export interface TimerConfig {
  /** 'total' = one budget for the whole quiz; 'per_question' = budget × N. */
  kind: 'total' | 'per_question';
  /** Seconds: total budget (kind='total') or per-question budget (kind='per_question'). */
  seconds: number;
}

/**
 * Play-time configuration carried from the generate page to the player pages via
 * sessionStorage (key `qf_play_config`). Separate from the persisted QuizConfig
 * because some of it (timer) only matters while playing.
 */
export interface PlayConfig {
  mode: QuizMode;
  timed: boolean;
  timer?: TimerConfig;
}

/** A single quiz question with its answer and source grounding. */
export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];        // for multiple_choice; for true_false use ['True','False']
  answer: string;            // canonical correct answer (for MC: the exact option text)
  explanation: string;       // why, grounded in the source
  source_quote: string;      // EXACT sentence(s) from the source that prove the answer
}

/** A generated quiz: metadata plus its list of questions. */
export interface Quiz {
  id: string;
  title: string;
  difficulty: Difficulty;
  source_type: SourceType;
  questions: Question[];
  created_at?: string;
  /** How this quiz was configured (style/mode/timer/focus) — persisted so retries
   *  and the dashboard can reflect the user's settings. Optional for old quizzes. */
  config?: QuizConfig;
  /**
   * Optional note shown to the user when the quiz couldn't fully meet the
   * request — e.g. "You asked for 30 questions, but your material only supported
   * 8 strong ones." Absent when the requested count was met.
   */
  warning?: string;
}

/** Payload sent to the quiz-generation API to request a new quiz. */
export interface GenerateRequest {
  content: string;          // the study material (may be "" for the AI tab if topic is set)
  types: QuestionType[];
  difficulty: Difficulty;
  count: number;            // requested number of questions (1-30)
  sourceType: SourceType;
  /** Optional phrasing style. Defaults to 'straightforward' if omitted. */
  style?: QuizStyle;
  /** Optional free-form "describe anything" text: context, focus areas, instructions. */
  focus?: string;
  /** AI tab: the topic/test description the user wants quizzed (no upload needed). */
  topic?: string;
  /** AI tab: true ⇒ the model may use its own knowledge (blended with any content). */
  useOwnKnowledge?: boolean;
}

/**
 * The configuration of a quiz, persisted alongside it (quizzes.config jsonb) so
 * retries reuse settings and the dashboard can show them. All optional so old
 * rows without a config still load.
 */
export interface QuizConfig {
  style?: QuizStyle;
  mode?: QuizMode;
  timed?: boolean;
  timer?: TimerConfig;
  focus?: string;
  sourceType?: SourceType;
}

/** A user's response to one question, with whether it was correct. */
export interface UserAnswer { questionId: string; given: string; correct: boolean; }
