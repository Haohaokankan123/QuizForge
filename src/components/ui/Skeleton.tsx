"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Border radius preset. Use "full" for avatars/pills. @default "md" */
  radius?: "sm" | "md" | "lg" | "full";
}

/**
 * Skeleton — single shimmer placeholder block.
 *
 * Renders an animate-pulse surface block for loading states (e.g. while the AI
 * generates a quiz). Size it with width/height utilities via className
 * (e.g. <Skeleton className="h-6 w-40" />). Pulse animation is disabled
 * automatically under prefers-reduced-motion (handled globally in globals.css).
 * Marked aria-hidden since it conveys no content.
 */
export function Skeleton({ radius = "md", className, ...rest }: SkeletonProps) {
  const radiusStyles = {
    sm: "rounded-md",
    md: "rounded-lg",
    lg: "rounded-2xl",
    full: "rounded-full",
  } as const;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-white/[0.06]",
        radiusStyles[radius],
        className,
      )}
      {...rest}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of shimmer lines to render. @default 3 */
  lines?: number;
}

/**
 * SkeletonText — a stack of shimmer lines approximating a paragraph.
 *
 * The final line is rendered shorter (70% width) to mimic real text ragging.
 * Convenience wrapper over Skeleton for the common multi-line case.
 */
export function SkeletonText({
  lines = 3,
  className,
  ...rest
}: SkeletonTextProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex flex-col gap-2.5", className)}
      {...rest}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-[70%]" : "w-full")}
        />
      ))}
    </div>
  );
}
