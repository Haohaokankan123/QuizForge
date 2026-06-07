/**
 * QuizForge UI primitives — barrel export.
 *
 * Import everything from "@/components/ui":
 *   import { Button, Card, Input, SegmentedControl } from "@/components/ui";
 *
 * All primitives are client components ("use client") styled with the design
 * tokens in globals.css and gate Framer Motion behind useReducedMotion().
 */

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Skeleton, SkeletonText } from "./Skeleton";
export type { SkeletonProps, SkeletonTextProps } from "./Skeleton";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant } from "./Badge";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

export { SegmentedControl } from "./SegmentedControl";
export type {
  SegmentedControlProps,
  SegmentedOption,
} from "./SegmentedControl";
