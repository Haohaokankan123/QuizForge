"use client";

import { forwardRef } from "react";
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element/tag (e.g. "section", "article"). @default "div" */
  as?: ElementType;
  /**
   * Surface treatment.
   * - "elevated": opaque elevated panel (--bg-elevated) — default, best for content.
   * - "glass": frosted translucent panel (uses the global .glass utility).
   * @default "elevated"
   */
  variant?: "elevated" | "glass";
  /** Padding preset. @default "md" */
  padding?: "none" | "sm" | "md" | "lg";
  children?: ReactNode;
}

const paddingStyles = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

/**
 * Card — elevated surface container.
 *
 * "elevated" (default) is an opaque --bg-elevated panel with a hairline border
 * and a soft shadow. "glass" uses the global frosted .glass utility. Both use
 * the 16px design radius (rounded-2xl). Accepts `as` to change the tag and
 * spreads remaining props. The caller's `className` is applied last so it wins.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as, variant = "elevated", padding = "md", className, children, ...rest },
  ref,
) {
  const Component = (as ?? "div") as ElementType;

  return (
    <Component
      ref={ref}
      className={cn(
        "rounded-2xl",
        variant === "glass"
          ? "glass"
          : "border border-border bg-bg-elevated shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_12px_40px_-16px_rgba(0,0,0,0.6)]",
        paddingStyles[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
});
