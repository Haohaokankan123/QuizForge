# QuizForge — Design System (MASTER)

**Source of truth for all UI work in QuizForge.** Every page, component, and
animation must conform to this document. Tokens are implemented in
`src/app/globals.css`; this file documents intent, usage, and constraints.

- **Aesthetic:** "Modern Dark (Cinema)" surface + "Friendly SaaS" type.
- **Feel:** Dark, premium, minimal, distraction-free, friendly, smooth and
  motivating.
- **Stack:** Next.js 16.2.7 (App Router) · React 19.2 · TypeScript ·
  Tailwind CSS v4 (CSS-first, no `tailwind.config.js`) · framer-motion ·
  lucide-react.

---

## 1. Design tokens

All tokens are defined twice in `src/app/globals.css`:

1. **Raw CSS variables on `:root`** — use directly in inline styles, gradients,
   box-shadows, and `var()` references (e.g. `var(--accent-glow)`).
2. **Tailwind utilities via `@theme inline`** — use as classes (e.g.
   `bg-accent`, `text-foreground-muted`).

`@theme inline` (not plain `@theme`) is required because each `--color-*` token
references a `:root` `var()`. This keeps `:root` the single source of truth so a
value is never duplicated.

### 1.1 Color tokens

| Purpose                | Raw CSS var          | Value                       | Tailwind utility prefix          |
| ---------------------- | -------------------- | --------------------------- | -------------------------------- |
| Deepest background     | `--bg-deep`          | `#060608`                   | `bg-bg-deep`                     |
| Base background        | `--bg-base`          | `#0B0B0F`                   | `bg-bg-base`                     |
| Elevated background    | `--bg-elevated`      | `#121218`                   | `bg-bg-elevated`                 |
| Translucent surface    | `--surface`          | `rgba(255,255,255,0.05)`    | `bg-surface`                     |
| Foreground (text)      | `--foreground`       | `#ECECEF`                   | `text-foreground`                |
| Muted foreground       | `--foreground-muted` | `#8A8F98`                   | `text-foreground-muted`          |
| Accent (indigo)        | `--accent`           | `#6366F1`                   | `bg-accent` / `text-accent` / `ring-accent` |
| Accent glow            | `--accent-glow`      | `rgba(99,102,241,0.22)`     | _(raw var only — shadows/glow)_  |
| Secondary (violet)     | `--secondary`        | `#A855F7`                   | `bg-secondary` / `text-secondary`|
| Success                | `--success`          | `#34D399`                   | `text-success` / `bg-success`    |
| Warning (gold scores)  | `--warning`          | `#FBBF24`                   | `text-warning` / `bg-warning`    |
| Destructive            | `--destructive`      | `#F87171`                   | `text-destructive`               |
| Border (hairline)      | `--border`           | `rgba(255,255,255,0.08)`    | `border-border`                  |

> `--accent-glow` is intentionally **not** mapped to a color utility — it is an
> RGBA glow used in `box-shadow` and `::selection`, not a fill color. Reference
> it as `var(--accent-glow)`.

**Background never pure `#000`** — OLED-safe deep grey only. Default page
background is `--bg-deep`; cards/panels step up to `--bg-elevated` or `--surface`.

### 1.2 Shape

| Token      | Value  | Usage                                                       |
| ---------- | ------ | ----------------------------------------------------------- |
| `--radius` | `16px` | Cards, modals, buttons, inputs. Exposed as `--radius` in theme. Use `rounded-2xl` (16px) for the canonical radius, or `rounded-[var(--radius)]`. |

### 1.3 Gradient

| Token              | Value                                                | Usage                          |
| ------------------ | ---------------------------------------------------- | ------------------------------ |
| `--gradient-brand` | `linear-gradient(135deg, var(--accent), var(--secondary))` | Hero headlines, score highlights, primary CTA fills. Apply via `.text-gradient-brand` for text. |

---

## 2. Typography

- **Family:** Plus Jakarta Sans, loaded via `next/font/google` in
  `src/app/layout.tsx`, exposed as the CSS variable `--font-jakarta`.
- **Weights to load:** 400, 500, 600, 700, 800.
- **Utility:** `font-sans` resolves to `var(--font-jakarta)` with system
  fallbacks. `body` already sets it as the default family.

### 2.1 Required layout.tsx setup

The font is a prerequisite for the whole system. `layout.tsx` must declare:

```tsx
import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// <html className={`${jakarta.variable} ...`}>
```

This is what wires `--font-jakarta` so `globals.css` (`--font-sans`, `body`) can
resolve it. Without it, type falls back to system sans.

### 2.2 Type scale (recommended)

| Role            | Size / line-height | Weight | Notes                         |
| --------------- | ------------------ | ------ | ----------------------------- |
| Display / hero  | `text-5xl`–`text-6xl` | 800 | Pair with `.text-gradient-brand` |
| H1              | `text-3xl`/`text-4xl` | 700 |                               |
| H2              | `text-2xl`         | 700    |                               |
| H3              | `text-xl`          | 600    |                               |
| Body            | `text-base`        | 400/500|                               |
| Small / caption | `text-sm`          | 500    | `text-foreground-muted`       |
| Numerals        | any                | 600/700| **Always `.tabular-nums`** for timers/scores |

### 2.3 Tabular figures

Timers, scores, counters, and any changing numeric value **must** use
`.tabular-nums` (or `tabular-nums` utility) so digit width is fixed and the UI
does not jitter as numbers change.

---

## 3. Motion

Animation library by stack (project rule):

- **This project is React/Next.js → use framer-motion** for component motion.
- Vanilla CSS keyframes are used only for the always-on ambient background
  (`.ambient-blob`) and reduced-motion overrides in `globals.css`.

### 3.1 Easing & spring

| Use                     | Value                                            |
| ----------------------- | ------------------------------------------------ |
| Standard easing         | `cubic-bezier(0.16, 1, 0.3, 1)` — token `--ease-cinema`, utility `ease-cinema` |
| Modal / dialog spring   | framer-motion `spring`, `damping: 20`, `stiffness: 90` |
| Press feedback          | scale `0.97` → `1.0` on tap/active               |
| Staggered list reveal   | `30–50ms` per item                               |

### 3.2 Ambient glow

- 2–3 slow, low-opacity glow blobs behind the hero only.
- Use the `.ambient-blob` class (blurred radius, drifting keyframe) or a
  framer-motion equivalent.
- Color the blobs with `--accent` / `--secondary` / `--accent-glow`.

### 3.3 Reduced motion — MANDATORY

- `globals.css` disables CSS transitions/animations and smooth scroll under
  `@media (prefers-reduced-motion: reduce)`.
- **Every framer-motion component must also gate via `useReducedMotion()`** and
  render a static (no-transform / instant) variant when motion is reduced. The
  CSS media query alone does not stop JS-driven framer-motion values.

### 3.4 Restraint

- Animate **max 1–2 elements per view**. No competing motion.
- Reveal-on-scroll and entrance animations are subtle, never bouncy or loud.

---

## 4. Reusable CSS utilities (in globals.css)

| Class                  | What it does                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `.glass`               | Frosted panel: `--surface` bg, `backdrop-filter: blur(16px)`, hairline border, `--radius`. Use on cards, modals, sticky headers, popovers. |
| `.tabular-nums`        | Fixed-width digits for timers/scores.                                        |
| `.text-gradient-brand` | Indigo→violet gradient clipped to text.                                      |
| `.glow-accent`         | Soft brand glow `box-shadow` for primary CTAs / active states.               |
| `.ambient-blob`        | Drifting blurred background orb (hero only).                                 |

---

## 5. Component conventions

### 5.1 Surfaces & elevation

- Page background: `bg-bg-deep`.
- Sections / large containers: `bg-bg-base`.
- Cards / raised panels: `bg-bg-elevated` **or** `.glass` (translucent variant).
- Every panel uses `border-border` (hairline) and `rounded-2xl` (16px).

### 5.2 Buttons

- **Primary:** `bg-accent text-foreground`, `rounded-2xl`, press-scale `0.97`,
  optional `.glow-accent`. Hover lightens slightly; focus shows the global ring.
- **Secondary / ghost:** `bg-surface` or transparent with `border-border`,
  `text-foreground`.
- **Destructive:** `text-destructive` / `bg-destructive` for irreversible actions.
- Minimum **44×44px** touch target. Never smaller.

### 5.3 Inputs

- `bg-bg-elevated` or `bg-surface`, `border-border`, `rounded-2xl`,
  `text-foreground`, placeholder `text-foreground-muted`.
- Focus uses the global `:focus-visible` indigo ring (already in `globals.css`).

### 5.4 Icons

- **lucide-react SVG icons ONLY. No emoji anywhere in the product.**
- Default icon color inherits `currentColor`; muted icons use
  `text-foreground-muted`.

### 5.5 Quiz-specific

- **Scores / streaks / XP:** gold `text-warning`, `.tabular-nums`, weight 700.
- **Correct answer:** `text-success` / success-tinted surface.
- **Incorrect answer:** `text-destructive` / destructive-tinted surface.
- **Timer:** `.tabular-nums`, monochrome `text-foreground`; turns
  `text-warning` then `text-destructive` as time runs low.
- **AI generation:** show **skeleton loaders** (pulsing `bg-surface` blocks),
  never a bare spinner-only screen.

### 5.6 Focus & accessibility

- Visible focus on every interactive element (global ring provided).
- Text contrast **≥ 4.5:1**. `--foreground` on dark backgrounds passes; never
  put `--foreground-muted` on `--surface` for body copy.
- Respect `prefers-reduced-motion` everywhere.

### 5.7 Responsive breakpoints

Design and verify at **375 / 768 / 1024 / 1440** px. Mobile-first; layouts must
not break or overflow at 375.

---

## 6. Anti-patterns (do NOT do)

- Do **not** use pure black `#000` backgrounds — use `--bg-deep`.
- Do **not** add a `tailwind.config.js`; this is a Tailwind v4 CSS-first project.
  All tokens belong in the `@theme inline` block of `globals.css`.
- Do **not** use plain `@theme` for tokens that reference `:root` vars — it must
  be `@theme inline`, otherwise the `var()` won't resolve into the utility value.
- Do **not** use emoji as icons. lucide-react only.
- Do **not** animate more than 1–2 elements per view; no loud/bouncy motion.
- Do **not** ship framer-motion animation without a `useReducedMotion()` gate.
- Do **not** hardcode hex colors in components — use tokens
  (`bg-accent`, `var(--accent)`), so the system stays single-sourced.
- Do **not** use proportional figures for timers/scores — always `.tabular-nums`.
- Do **not** drop below 44px touch targets or remove focus rings.
- Do **not** duplicate token values; edit them in `:root` in `globals.css` only.

---

## 7. Token quick reference for other agents

Use these exact names. Color utilities (from `@theme inline`):

```
bg-bg-deep · bg-bg-base · bg-bg-elevated · bg-surface
text-foreground · text-foreground-muted
bg-accent · text-accent · ring-accent · bg-secondary · text-secondary
text-success · text-warning · text-destructive
border-border
```

Raw CSS vars (direct `var()` use):

```
--bg-deep --bg-base --bg-elevated --surface
--foreground --foreground-muted
--accent --accent-glow --secondary
--success --warning --destructive
--border --radius
--ease-cinema --gradient-brand
--font-jakarta  (set by layout.tsx via next/font)
```

Helper classes:

```
.glass · .tabular-nums · .text-gradient-brand · .glow-accent · .ambient-blob
```

Easing: `ease-cinema` / `var(--ease-cinema)` = `cubic-bezier(0.16,1,0.3,1)`.
Radius: `16px` (`rounded-2xl` or `var(--radius)`).
