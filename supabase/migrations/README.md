# QuizForge — Database Migrations

This folder holds the SQL that sets up the QuizForge database in Supabase
(Postgres). There is no migration CLI here — you run the SQL by hand in the
Supabase SQL Editor.

## Files

- **`0001_init.sql`** — the full initial schema: tables, Row Level Security
  (RLS) policies, the auto-profile trigger, and a helper function.

## How to run it

1. Open your Supabase project dashboard: <https://supabase.com/dashboard>
   (project ref **`roesuvlyguwrylyqzjxi`**).
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open `0001_init.sql`, copy its **entire** contents, and paste into the editor.
5. Click **Run** (or press Cmd/Ctrl + Enter).
6. You should see a success message with no errors.

## Verify it worked

After running:

- **Table Editor** should list three tables: `profiles`, `quizzes`, `attempts`.
- **Authentication → Policies** (or Table Editor → each table → "RLS" tab)
  should show the policies created below.
- Sign up in the app with **`haiou.chenho@gmail.com`**. Open the `profiles`
  table — that row should have **`is_owner = true`**. Any other signup gets
  `is_owner = false`.

## Safe to re-run

`0001_init.sql` is **idempotent** — running it again will not error or create
duplicates. It uses:

- `create table if not exists` — skips tables that already exist.
- `drop policy if exists` before each `create policy` — replaces policies cleanly.
- `create or replace function` — overwrites function bodies in place.
- `drop trigger if exists` before `create trigger` — re-attaches the trigger safely.
- `on conflict (id) do nothing` in the trigger — never errors on a duplicate profile.

So if you change a policy or the trigger later, just edit the file and run the
whole thing again.

## Owner email is hardcoded

The owner account email **`haiou.chenho@gmail.com`** is written directly into the
`handle_new_user()` trigger function in `0001_init.sql`. When that user signs up,
their profile is automatically flagged `is_owner = true`.

This must match the **`OWNER_EMAIL`** value in `.env.local`
(`OWNER_EMAIL=haiou.chenho@gmail.com`). If you ever change the owner email,
update **both** places: the SQL function and the env var.

## What the schema contains

### Tables

| Table      | Purpose                                              | Key columns |
|------------|------------------------------------------------------|-------------|
| `profiles` | One row per signed-up user (app-safe copy of auth)   | `id` (= auth user id), `email`, `display_name`, `is_owner`, `created_at` |
| `quizzes`  | One row per generated quiz; questions stored as JSON | `id`, `user_id`, `title`, `difficulty`, `source_type`, `questions` (jsonb), `share_id` (unique), `is_public`, `created_at` |
| `attempts` | One row per quiz attempt (score + answers)           | `id`, `quiz_id`, `user_id`, `score`, `total`, `answers` (jsonb), `duration_seconds`, `created_at` |

Indexes: `quizzes (user_id, created_at desc)` and
`attempts (user_id, created_at desc)` — both speed up the "my newest rows first"
queries used by the dashboard and history pages.

### Row Level Security (RLS) policies

RLS is **enabled on all three tables**. `auth.uid()` is the logged-in user's id.

- **`profiles`**
  - `profiles_select_own` — read your own profile (`auth.uid() = id`).
  - `profiles_insert_own` — create your own profile (`auth.uid() = id`).
  - `profiles_update_own` — update your own profile (`auth.uid() = id`).

- **`quizzes`**
  - `quizzes_owner_all` — full CRUD on quizzes you own (`auth.uid() = user_id`).
  - `quizzes_public_select` — **anyone (including logged-out visitors)** can read
    a quiz where `is_public = true`. Powers public share links. (Policies are
    OR-combined, so a row is readable if you own it *or* it is public.)

- **`attempts`**
  - `attempts_owner_all` — full CRUD on your own attempts (`auth.uid() = user_id`).
    Attempts are always private to the user who made them.

### Trigger

- **`on_auth_user_created`** runs `handle_new_user()` **after insert on
  `auth.users`**. It copies the new user's `id` and `email` into `profiles` and
  sets `is_owner = (email = 'haiou.chenho@gmail.com')`. It is `security definer`
  with a locked `search_path = public, pg_temp` (the safe pattern), and uses
  `on conflict (id) do nothing` so it never errors on duplicates.

### Helper function

- **`weekly_quiz_count(uid uuid) returns int`** — counts a user's quizzes created
  in the last 7 days (`created_at > now() - interval '7 days'`). Used as a
  server-side reference / fallback; the app also counts this in code.
