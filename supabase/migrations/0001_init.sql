-- ============================================================================
-- QuizForge — Initial database schema (migration 0001_init)
-- ============================================================================
--
-- WHAT THIS FILE IS:
--   The full database setup for QuizForge. You paste this whole file into the
--   Supabase SQL Editor and click "Run". It creates the tables, security rules
--   (RLS = Row Level Security), an automatic profile-creator trigger, and a
--   small helper function.
--
-- WHY IT EXISTS:
--   Supabase gives you a Postgres database, but it starts empty. This file
--   defines exactly what data we store (quizzes, attempts, profiles) and who is
--   allowed to read/write each row. Without it, the app has nowhere to save data
--   and no security.
--
-- IS IT SAFE TO RE-RUN?
--   Yes. Every block is written to be "idempotent" — meaning running it a second
--   time will not error or create duplicates. We use:
--     - "create table if not exists"  (skip if the table already exists)
--     - "drop policy if exists" before each "create policy" (replace cleanly)
--     - "create or replace function" (overwrite the function body)
--     - "drop trigger if exists" before "create trigger"
--
-- OWNER ACCOUNT:
--   The email 'haiou.chenho@gmail.com' is hardcoded below. When that user signs
--   up, their profile row is automatically flagged is_owner = true. This matches
--   the OWNER_EMAIL value in .env.local.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- TABLE 1: profiles
-- ----------------------------------------------------------------------------
-- One row per signed-up user. Supabase Auth already stores logins in the
-- hidden "auth.users" table, but that table is locked down and not meant for
-- app data. "profiles" is OUR copy of the safe-to-use user fields, living in
-- the normal "public" schema where the app can read/write it.
--
--   id           = same UUID as the auth user (this links the two tables).
--                  "references auth.users(id) on delete cascade" means: if the
--                  auth user is deleted, this profile row is deleted too.
--   email        = the user's email (copied from auth on signup).
--   display_name = an optional friendly name the user can set later.
--   is_owner     = true only for the app owner (Charles). Lets us show owner-only
--                  features or bypass limits in app code.
--   created_at   = when the row was made; defaults to the current time.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  is_owner     boolean     not null default false,
  created_at   timestamptz          default now()
);


-- ----------------------------------------------------------------------------
-- TABLE 2: quizzes
-- ----------------------------------------------------------------------------
-- One row per generated quiz. The actual questions are stored as JSON in the
-- "questions" column (jsonb), matching the Question[] shape from @/lib/types.
--
--   id          = unique quiz id, auto-generated UUID.
--   user_id     = which user owns this quiz (links to auth.users; cascade delete
--                 removes a user's quizzes when the user is deleted).
--   title       = the quiz title.
--   difficulty  = 'easy' | 'medium' | 'hard' (stored as text; app enforces values).
--   source_type = 'text' | 'txt' | 'pdf' | 'docx' | 'youtube' (where the source
--                 came from; stored as text).
--   questions   = jsonb array of Question objects (prompt, options, answer, etc).
--                 jsonb = JSON stored in an efficient binary form Postgres can
--                 index and query.
--   share_id    = a short random public token. When set, the quiz can be opened
--                 via a share link. "unique" stops two quizzes sharing a token.
--                 NULL means "no share link yet".
--   is_public   = true if this quiz is readable by anyone with the share link
--                 (even logged-out visitors). Default false = private.
--   created_at  = when the quiz was generated.
-- ----------------------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text        not null,
  difficulty  text        not null,
  source_type text        not null,
  questions   jsonb       not null,
  share_id    text        unique,
  is_public   boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Speeds up "show me my quizzes, newest first" — the main dashboard query.
-- Without this index, Postgres would scan every quiz row to find one user's.
create index if not exists quizzes_user_created_idx
  on public.quizzes (user_id, created_at desc);


-- ----------------------------------------------------------------------------
-- TABLE 3: attempts
-- ----------------------------------------------------------------------------
-- One row each time a user finishes (or submits) a quiz. Stores their score and
-- the per-question answers, so we can show history and review pages.
--
--   id               = unique attempt id, auto-generated UUID.
--   quiz_id          = which quiz was attempted (cascade delete: deleting the
--                      quiz removes its attempts).
--   user_id          = who made the attempt (cascade delete with the user).
--   score            = number of correct answers.
--   total            = number of questions in the quiz at attempt time.
--   answers          = jsonb array of UserAnswer objects
--                      ({ questionId, given, correct }). Defaults to '[]'.
--   duration_seconds = how long the attempt took, in seconds (nullable — we may
--                      not always track it).
--   created_at       = when the attempt was recorded.
-- ----------------------------------------------------------------------------
create table if not exists public.attempts (
  id               uuid primary key default gen_random_uuid(),
  quiz_id          uuid        references public.quizzes(id) on delete cascade,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  score            int         not null,
  total            int         not null,
  answers          jsonb       not null default '[]',
  duration_seconds int,
  created_at       timestamptz not null default now()
);

-- Speeds up "show me my attempt history, newest first".
create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- RLS is Postgres's per-row permission system. Once enabled on a table, NO row
-- is readable or writable unless a "policy" explicitly allows it. This is what
-- keeps user A from seeing user B's quizzes — even though both use the same
-- public anon key in the browser.
--
-- "auth.uid()" is a Supabase function that returns the UUID of the currently
-- logged-in user (or NULL if nobody is logged in). We compare it to the row's
-- owner column to decide access.
-- ============================================================================

-- Turn RLS ON for all three tables. (Safe to run repeatedly.)
alter table public.profiles enable row level security;
alter table public.quizzes  enable row level security;
alter table public.attempts enable row level security;


-- ----------------------------------------------------------------------------
-- POLICIES: profiles
-- ----------------------------------------------------------------------------
-- A user may read, create, and update ONLY their own profile row (the row whose
-- id matches their logged-in uid). We do not add a DELETE policy — profiles are
-- removed automatically via the cascade when the auth user is deleted.
--
-- "using"      controls which existing rows a command can see/affect (SELECT,
--              UPDATE, DELETE).
-- "with check" controls what NEW or CHANGED row values are allowed (INSERT, UPDATE).
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- POLICIES: quizzes
-- ----------------------------------------------------------------------------
-- Two kinds of access:
--
--   1) The OWNER of a quiz row (auth.uid() = user_id) has full CRUD —
--      they can SELECT, INSERT, UPDATE, and DELETE their own quizzes.
--      We express this with one "for all" policy.
--
--   2) ANYONE (including logged-out / anonymous visitors) may SELECT a quiz row
--      when is_public = true. This powers public share links. It is a separate
--      SELECT-only policy. Postgres combines multiple policies with OR, so a row
--      is readable if you own it OR it is public.
-- ----------------------------------------------------------------------------

-- (1) Full CRUD for the row owner.
drop policy if exists "quizzes_owner_all" on public.quizzes;
create policy "quizzes_owner_all"
  on public.quizzes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (2) Public read for shared quizzes (anyone, even anon).
drop policy if exists "quizzes_public_select" on public.quizzes;
create policy "quizzes_public_select"
  on public.quizzes for select
  using (is_public = true);


-- ----------------------------------------------------------------------------
-- POLICIES: attempts
-- ----------------------------------------------------------------------------
-- A user may read, create, update, and delete ONLY their own attempt rows.
-- Attempts are always private to the user who made them.
-- ----------------------------------------------------------------------------
drop policy if exists "attempts_owner_all" on public.attempts;
create policy "attempts_owner_all"
  on public.attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================================
-- TRIGGER: auto-create a profile when a new auth user signs up
-- ============================================================================
-- Supabase inserts a row into auth.users every time someone registers. We want
-- a matching public.profiles row created automatically — otherwise the app
-- would have to create it by hand on every signup.
--
-- handle_new_user() runs AFTER each insert into auth.users and copies the id and
-- email into profiles. It also sets is_owner = true if the new email matches the
-- hardcoded owner address.
--
-- "security definer" = the function runs with the privileges of its creator (the
--   table owner), NOT the calling user. This is required because the new signup
--   is not yet a logged-in session that RLS would allow to write profiles.
--
-- "set search_path = public, pg_temp" = locks the schema search path so the
--   function always resolves "profiles" to public.profiles. This is the safe
--   pattern for security-definer functions (prevents a malicious schema on the
--   search path from hijacking the function).
--
-- "on conflict (id) do nothing" = if a profile already exists (e.g. the trigger
--   somehow runs twice), do not error — just skip. Keeps things idempotent.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, is_owner)
  values (
    new.id,
    new.email,
    (new.email = 'haiou.chenho@gmail.com')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Re-create the trigger cleanly (drop first so re-running this file is safe).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ============================================================================
-- HELPER FUNCTION: weekly_quiz_count(uid)
-- ============================================================================
-- Returns how many quizzes the given user created in the last 7 days. The app
-- also counts this in code to enforce any weekly generation limit; this SQL
-- version is a reference / server-side fallback you can call from the database.
--
--   uid   = the user's UUID to count quizzes for.
--   returns int = the count.
--
-- "now() - interval '7 days'" = the timestamp exactly one week ago. We count
--   quizzes whose created_at is newer than that.
--
-- "language sql stable" = a simple SQL function with no side effects; "stable"
--   tells Postgres the result won't change within a single statement, allowing
--   optimization.
-- ============================================================================
create or replace function public.weekly_quiz_count(uid uuid)
returns int
language sql
stable
as $$
  select count(*)::int
  from public.quizzes
  where user_id = uid
    and created_at > now() - interval '7 days';
$$;


-- ============================================================================
-- DONE. After running, verify in the Supabase dashboard:
--   - Table Editor shows: profiles, quizzes, attempts
--   - Authentication > Policies shows the policies listed above
--   - Sign up with haiou.chenho@gmail.com -> profiles row has is_owner = true
-- ============================================================================
