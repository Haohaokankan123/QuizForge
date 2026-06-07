"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  /** Current progress value. @default 0 */
  value: number;
  /** Maximum value that represents 100%. @default 100 */
  max?: number;
  /** Track + fill height. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Fill color. "brand" = indigo→violet gradient. @default "brand" */
  tone?: "brand" | "success" | "warning" | "danger";
  /** Accessible label describing what is progressing (for screen readers). */
  label?: string;
  /** Extra classes applied to the outer track. */
  className?: string;
}

const sizeStyles = { sm: "h-1.5", md: "h-2.5", lg: "h-3.5" } as const;

const toneStyles = {
  brand: "bg-[linear-gradient(90deg,var(--accent),var(--secondary))]",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

/**
 * ProgressBar — animated fill bar (quiz progress, score reveal, upload).
 *
 * The fill animates its scaleX (transform-safe, GPU-friendly) from its previous
 * value to the new percentage using the cinematic easing curve. Under
 * prefers-reduced-motion the fill jumps instantly. Exposes proper ARIA
 * (role="progressbar" + aria-valuenow/min/max) and an optional aria-label.
 */
export function ProgressBar({
  value,
  max = 100,
  size = "md",
  tone = "brand",
  label,
  className,
}: ProgressBarProps) {
  const reduceMotion = useReducedMotion();

  const safeMax = max <= 0 ? 100 : max;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = (clamped / safeMax) * 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-label={label}
      className={cn(
        "w-full overflow-hidden rounded-full bg-white/[0.06]",
        sizeStyles[size],
        className,
      )}
    >
      {/* scaleX from a fixed-width (100%) child keeps the animation on the GPU
          and avoids layout thrash from animating `width`. */}
      <motion.div
        className={cn("h-full w-full origin-left rounded-full", toneStyles[tone])}
        initial={false}
        animate={{ scaleX: pct / 100 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.6, ease: [0.16, 1, 0.3, 1] }
        }
      />
    </div>
  );
}
