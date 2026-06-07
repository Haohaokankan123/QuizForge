"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Badge color intent.
 * - neutral: generic tag
 * - accent / secondary: brand tints (e.g. question type)
 * - success / warning / danger: status + score tiers (warning = gold scores)
 */
export type BadgeVariant =
  | "neutral"
  | "accent"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color intent. @default "neutral" */
  variant?: BadgeVariant;
  /** Pill size. @default "md" */
  size?: "sm" | "md";
  /** Optional leading icon (lucide-react SVG). */
  icon?: ReactNode;
  children?: ReactNode;
}

// Tinted fills: low-opacity background + saturated text + matching hairline.
// accent/secondary use LIGHTER text (indigo-300 / purple-300) than the raw brand
// color: #6366F1 / #A855F7 on their /15 fills measure only ~3.6:1 / ~4.0:1 (below
// WCAG AA 4.5:1 for this small badge text), while the -300 shades clear ~7:1.
const variantStyles: Record<BadgeVariant, string> = {
  neutral: "bg-white/[0.06] text-foreground-muted border-white/10",
  accent: "bg-accent/15 text-[#a5b4fc] border-accent/25",
  secondary: "bg-secondary/15 text-[#d8b4fe] border-secondary/25",
  success: "bg-success/15 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/25",
  danger: "bg-destructive/15 text-destructive border-destructive/25",
};

const sizeStyles = {
  sm: "h-5 px-2 text-[11px] gap-1",
  md: "h-6 px-2.5 text-xs gap-1.5",
} as const;

/**
 * Badge — small pill for difficulty, question type, and score tiers.
 *
 * Six color variants (neutral, accent, secondary, success, warning=gold, danger)
 * and two sizes. Renders a non-interactive <span> with tabular figures so
 * numeric badges (scores) don't jitter. Spreads rest props for data-* / aria.
 */
export function Badge({
  variant = "neutral",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium tabular-nums whitespace-nowrap",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...rest}
    >
      {icon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
