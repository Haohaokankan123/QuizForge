# QuizForge

**Turn anything into a quiz.** Paste your notes, upload a PDF, or drop a YouTube link — QuizForge uses AI to write a quiz grounded **only** in your material. No outside facts, no made-up answers; every question is backed by an exact quote from your source.

> Built by Charles Chen.

## 🔗 Live

- **App (Vercel):** https://quizforge-phi.vercel.app
- **App (Cloudflare):** https://quizforge.quizforge.workers.dev

Both run the same backend — your account, saved quizzes, and progress are shared across them.

## ✨ Features

- **Any input** — paste text, upload `.txt` / `.pdf` / `.docx`, or paste a YouTube link (uses the captions).
- **Strictly grounded** — the AI may only use *your* content. Every answer carries the exact `source_quote` that proves it.
- **Universal difficulty** — Easy / Medium / Hard work across *every* subject (vocab, math, science, history, coding). "Hard" means real reasoning: multi-step math word problems, code-tracing, cause-and-effect — not just recall.
- **All question types** — multiple choice, true/false, fill-in-the-blank, short answer.
- **Pick how many** — 1 to 30 questions. Quality over quantity: if your source can't support that many strong questions, it makes fewer and tells you.
- **Study tools** — saved history + retry, progress dashboard, flashcard mode, timed mode, shareable quiz links, explain-wrong-answers, and PDF export.
- **Accounts** — email/password + Google sign-in (Supabase). Free users get 20 quizzes/week; the owner account is unlimited.
- **Polished + accessible** — dark, minimal UI; reduced-motion safe; WCAG-AA contrast; works on mobile.

## 🛠️ Tech Stack

- **[Next.js 16](https://nextjs.org/)** (App Router, TypeScript) — pages, protected routes, and serverless API routes in one app.
- **[Groq](https://groq.com/)** (`openai/gpt-oss-120b`) — fast, free LLM. The API key stays server-side only.
- **[Supabase](https://supabase.com/)** — Postgres + Auth + Row Level Security (the weekly limit is enforced at the database).
- **[Tailwind CSS v4](https://tailwindcss.com/)** + **[Framer Motion](https://www.framer.com/motion/)** — styling and animation.
- Deployed to **Vercel** and **Cloudflare Workers** (via the [OpenNext](https://opennext.js.org/cloudflare) adapter).

## 🚀 Run it locally

```bash
# 1. Install dependencies
npm install

# 2. Create .env.local with your own keys (see below)

# 3. Start the dev server
npm run dev
# open http://localhost:3000
```

### Environment variables (`.env.local`)

These are **secret** — never commit them (this repo's `.gitignore` already excludes `.env*`).

```bash
GROQ_API_KEY=your_groq_key            # free at console.groq.com/keys
NEXT_PUBLIC_SUPABASE_URL=your_url     # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # Supabase anon (public) key
SUPABASE_SERVICE_ROLE_KEY=...         # Supabase service role (server-only!)
OWNER_EMAIL=you@example.com           # the unlimited owner account
```

The database schema lives in [`supabase/migrations/`](supabase/migrations/) — run it in your Supabase project's SQL editor.

## 📦 Deploy

- **Vercel:** `vercel --prod` (set the env vars in the Vercel dashboard).
- **Cloudflare Workers:** `npm run cf:deploy` (set secrets with `wrangler secret put`).

## 📝 How it stays honest

The AI is told to generate questions answerable **solely** from your source, and to include the exact sentence(s) that justify each answer. The server then re-checks every question and throws away any that break the rules — so a hallucinated or ungrounded answer never reaches you. That `source_quote` is what powers both the "explain my wrong answers" feature and the strict-content guarantee.
