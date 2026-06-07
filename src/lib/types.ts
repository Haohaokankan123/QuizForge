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
  source_type: 'text' | 'txt' | 'pdf' | 'docx' | 'youtube';
  questions: Question[];
  created_at?: string;
  /**
   * Optional note shown to the user when the quiz couldn't fully meet the
   * request — e.g. "You asked for 30 questions, but your material only supported
   * 8 strong ones." Absent when the requested count was met.
   */
  warning?: string;
}

/** Payload sent to the quiz-generation API to request a new quiz. */
export interface GenerateRequest {
  content: string;
  types: QuestionType[];
  difficulty: Difficulty;
  count: number;            // requested number of questions (1-20)
  sourceType: Quiz['source_type'];
}

/** A user's response to one question, with whether it was correct. */
export interface UserAnswer { questionId: string; given: string; correct: boolean; }
