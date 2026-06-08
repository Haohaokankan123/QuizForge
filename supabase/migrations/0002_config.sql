-- QuizForge migration 0002 — quiz configuration
--
-- Adds a single `config` jsonb column to the quizzes table so we can store HOW a
-- quiz was set up (phrasing style, play mode, timer, focus text, source type).
-- This powers "Retry my mistakes" reusing your settings and richer dashboard
-- detail. It is nullable, so every existing quiz row keeps working unchanged.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Safe to run more than once ("if not exists").

alter table public.quizzes
  add column if not exists config jsonb;

-- No RLS changes needed: `config` lives on a row already protected by the
-- existing quizzes policies (owner reads/writes their own rows). The shape is:
--   { "style": "...", "mode": "...", "timed": bool, "timer": {...},
--     "focus": "...", "sourceType": "..." }
-- matching the QuizConfig type in src/lib/types.ts.
--
-- Note: source_type stays a plain text column (no CHECK constraint), so the new
-- 'ai' and 'photo' values are accepted with no further migration.
