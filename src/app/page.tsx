"use client";

/**
 * QuizForge — Landing page.
 *
 * Premium dark cinematic marketing page. The AmbientBackground (rendered once
 * in the root layout) already sits behind everything via `fixed inset-0 -z-10`,
 * so every section here is transparent and lets the glow blobs show through.
 *
 * Style: "Modern Dark (Cinema)" tokens + a Bento-style feature grid.
 * Motion: staggered Framer Motion reveals, all gated behind useReducedMotion().
 */

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  BrainCircuit,
  Sparkles,
  ArrowRight,
  Upload,
  Wand2,
  Target,
  ListChecks,
  ShieldCheck,
  Quote,
  Layers,
  Timer,
  LineChart,
  Share2,
  FileDown,
  GraduationCap,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";

/* --------------------------------------------------------------------------
   Motion primitives — cinematic easing, all reduced-motion safe.
   When reduced motion is on, variants resolve to a no-op (opacity 1, no shift).
   -------------------------------------------------------------------------- */
const EASE = [0.16, 1, 0.3, 1] as const;

/** Container that staggers its children's entrance by ~50ms. */
const staggerParent: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

/** A single item rising + fading in. */
const riseItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
};

/* --------------------------------------------------------------------------
   Static content data
   -------------------------------------------------------------------------- */
const STEPS = [
  {
    icon: Upload,
    title: "Paste or upload",
    body: "Drop in notes, an article, a PDF, a Word doc, or a YouTube link. Your material, your way.",
  },
  {
    icon: Wand2,
    title: "AI builds it from your content",
    body: "QuizForge writes questions grounded only in what you gave it — no outside facts, no hallucinations.",
  },
  {
    icon: Target,
    title: "Study, retry, track progress",
    body: "Take the quiz, review explanations with source quotes, and watch your scores climb over time.",
  },
] as const;

const FEATURES = [
  {
    icon: ListChecks,
    title: "Multiple question types",
    body: "Multiple choice, true / false, fill-in-the-blank, and short answer — mixed to match how you learn.",
  },
  {
    icon: ShieldCheck,
    title: "Strict source-only",
    body: "Every question is answerable from your material alone. No trivia the source never mentioned.",
  },
  {
    icon: Quote,
    title: "Explanations with source quotes",
    body: "Each answer shows the exact sentence from your material that proves it. Trust, verified.",
  },
  {
    icon: Layers,
    title: "Flashcards",
    body: "Flip through your quiz as flashcards for fast, low-pressure recall practice.",
  },
  {
    icon: Timer,
    title: "Timed mode",
    body: "Add a countdown to simulate exam pressure and sharpen your speed under the clock.",
  },
  {
    icon: LineChart,
    title: "Progress tracking",
    body: "See accuracy trends across attempts so you always know what to study next.",
  },
  {
    icon: Share2,
    title: "Shareable quizzes",
    body: "Send a quiz to a classmate or study group with a single link.",
  },
  {
    icon: FileDown,
    title: "PDF export",
    body: "Export any quiz to a clean printable PDF for offline, paper-and-pen review.",
  },
] as const;

export default function Home() {
  const reduceMotion = useReducedMotion();

  // Reveal on mount, not on scroll. We deliberately avoid Framer Motion's
  // `whileInView` here: its IntersectionObserver can fail to fire on first
  // paint (and during headless full-page screenshots), which leaves items
  // stuck at opacity:0 — i.e. whole sections render invisible. A mount-driven
  // `animate="show"` is reliable and still gives the staggered entrance.
  // When reduced motion is requested, both states resolve to fully visible.
  const revealProps = {
    initial: reduceMotion ? ("show" as const) : ("hidden" as const),
    animate: "show" as const,
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* ===================================================================
          NAV — transparent, sticky, frosted on scroll via .glass
          =================================================================== */}
      <header className="sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="group inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep"
            aria-label="QuizForge home"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--gradient-brand)] shadow-[0_8px_24px_-8px_var(--accent-glow)]">
              <BrainCircuit className="size-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-foreground">
              QuizForge
            </span>
          </Link>

          <Link
            href="/generate"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep"
          >
            Get started
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* =================================================================
            HERO
            ================================================================= */}
        <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:pb-28 lg:pt-32">
          <motion.div
            variants={staggerParent}
            initial={reduceMotion ? "show" : "hidden"}
            animate="show"
            className="mx-auto flex max-w-3xl flex-col items-center text-center"
          >
            <motion.div variants={riseItem}>
              <Badge variant="accent" size="md" icon={<Sparkles className="size-3.5" />}>
                Grounded only in your material
              </Badge>
            </motion.div>

            <motion.h1
              variants={riseItem}
              className="mt-6 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              Turn anything into a{" "}
              <span className="text-gradient-brand">quiz in seconds</span>
            </motion.h1>

            <motion.p
              variants={riseItem}
              className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-foreground-muted sm:text-lg"
            >
              Paste notes, upload a PDF, or drop a YouTube link. QuizForge writes
              questions using <span className="font-semibold text-foreground">only</span> your
              source — no outside facts, no made-up answers, every question backed by an
              exact quote.
            </motion.p>

            <motion.div
              variants={riseItem}
              className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row"
            >
              <Link
                href="/generate"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-7 text-base font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep sm:w-auto"
              >
                <Sparkles className="size-5" aria-hidden="true" />
                Generate a quiz
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-7 text-base font-semibold text-foreground transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep sm:w-auto"
              >
                See how it works
              </Link>
            </motion.div>

            <motion.p
              variants={riseItem}
              className="mt-6 text-sm text-foreground-muted"
            >
              No outside trivia. Just what you studied.
            </motion.p>
          </motion.div>
        </section>

        {/* =================================================================
            HOW IT WORKS — 3 steps
            ================================================================= */}
        <section
          id="how-it-works"
          className="scroll-mt-24 px-5 py-20 sm:px-8 lg:py-24"
        >
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                From source to quiz in three steps
              </h2>
              <p className="mt-4 text-base text-foreground-muted sm:text-lg">
                No setup, no templates. Bring your material and start studying.
              </p>
            </div>

            <motion.ol
              {...revealProps}
              variants={staggerParent}
              className="mt-14 grid gap-5 md:grid-cols-3"
            >
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <motion.li key={step.title} variants={riseItem}>
                    <Card variant="glass" padding="lg" className="h-full">
                      <div className="flex items-center gap-3">
                        <span className="grid size-11 place-items-center rounded-2xl border border-border bg-surface">
                          <Icon className="size-5 text-accent" aria-hidden="true" />
                        </span>
                        <span className="tabular-nums text-sm font-bold text-foreground-muted">
                          Step {i + 1}
                        </span>
                      </div>
                      <h3 className="mt-5 text-lg font-bold text-foreground">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
                        {step.body}
                      </p>
                    </Card>
                  </motion.li>
                );
              })}
            </motion.ol>
          </div>
        </section>

        {/* =================================================================
            FEATURES — bento-style glass grid with hover lift
            ================================================================= */}
        <section className="px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="secondary" size="md">
                Everything you need to study smarter
              </Badge>
              <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Built for real revision, not busywork
              </h2>
              <p className="mt-4 text-base text-foreground-muted sm:text-lg">
                Every feature points at one goal: helping you actually remember
                what you studied.
              </p>
            </div>

            <motion.ul
              {...revealProps}
              variants={staggerParent}
              className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <motion.li key={feature.title} variants={riseItem}>
                    <motion.div
                      whileHover={
                        reduceMotion ? undefined : { y: -6, scale: 1.02 }
                      }
                      transition={{ duration: 0.25, ease: EASE }}
                      className="glass h-full p-6"
                    >
                      <span className="grid size-11 place-items-center rounded-2xl border border-border bg-surface">
                        <Icon className="size-5 text-accent" aria-hidden="true" />
                      </span>
                      <h3 className="mt-5 text-base font-bold text-foreground">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
                        {feature.body}
                      </p>
                    </motion.div>
                  </motion.li>
                );
              })}
            </motion.ul>
          </div>
        </section>

        {/* =================================================================
            MADE FOR STUDENTS — framing line
            ================================================================= */}
        <section className="px-5 py-12 sm:px-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted">
              <GraduationCap className="size-4 text-secondary" aria-hidden="true" />
              Made for students
            </span>
            <p className="text-balance text-2xl font-bold leading-snug text-foreground sm:text-3xl">
              Whether it&apos;s lecture notes the night before an exam or a
              chapter you keep forgetting, QuizForge turns it into focused
              practice that sticks.
            </p>
          </div>
        </section>

        {/* =================================================================
            FINAL CTA
            ================================================================= */}
        <section className="px-5 py-20 sm:px-8 lg:py-28">
          <motion.div
            {...revealProps}
            variants={staggerParent}
            className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-bg-elevated px-6 py-16 text-center sm:px-12"
          >
            {/* soft brand wash behind the CTA panel */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 opacity-60"
              style={{
                background:
                  "radial-gradient(60% 80% at 50% 0%, var(--accent-glow) 0%, transparent 70%)",
              }}
            />
            <motion.h2
              variants={riseItem}
              className="text-balance text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
            >
              Ready to{" "}
              <span className="text-gradient-brand">ace your next exam?</span>
            </motion.h2>
            <motion.p
              variants={riseItem}
              className="mx-auto mt-5 max-w-xl text-base text-foreground-muted sm:text-lg"
            >
              Generate your first quiz in seconds. Bring any material — we&apos;ll
              do the rest, strictly from your source.
            </motion.p>
            <motion.div variants={riseItem} className="mt-9">
              <Link
                href="/generate"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-8 text-base font-semibold text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep"
              >
                <Sparkles className="size-5" aria-hidden="true" />
                Generate a quiz
              </Link>
            </motion.div>
          </motion.div>
        </section>
      </main>

      {/* ===================================================================
          FOOTER
          =================================================================== */}
      <footer className="border-t border-border px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep"
            aria-label="QuizForge home"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-[var(--gradient-brand)]">
              <BrainCircuit className="size-4 text-white" aria-hidden="true" />
            </span>
            <span className="text-base font-extrabold tracking-tight text-foreground">
              QuizForge
            </span>
          </Link>

          <p className="text-sm text-foreground-muted">
            Quizzes built strictly from your material.
          </p>

          <p className="tabular-nums text-sm text-foreground-muted">
            &copy; {new Date().getFullYear()} QuizForge
          </p>
        </div>
      </footer>
    </div>
  );
}
