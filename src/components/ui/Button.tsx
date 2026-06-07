"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** Visual style of the button. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** Physical size of the button. Controls height, padding, and text size. */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Native button attributes minus the handlers whose signatures collide with
 * Framer Motion's motion props on the underlying motion.button (drag + the
 * animation/transition lifecycle events). We don't expose those native events.
 */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragExit"
  | "onDragLeave"
  | "onDragOver"
  | "onDrop"
>;

export interface ButtonProps extends NativeButtonProps {
  /** Visual style. @default "primary" */
  variant?: ButtonVariant;
  /** Size preset. md/lg meet the 44px+ touch target. @default "md" */
  size?: ButtonSize;
  /** When true, shows a spinner and disables the button. @default false */
  loading?: boolean;
  /** Stretch to fill the parent's width. @default false */
  fullWidth?: boolean;
  /** Optional icon rendered before the label. */
  leftIcon?: ReactNode;
  /** Optional icon rendered after the label. */
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-2xl " +
  "font-semibold whitespace-nowrap select-none cursor-pointer " +
  "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base " +
  "disabled:pointer-events-none disabled:opacity-50";

const variantStyles: Record<ButtonVariant, string> = {
  // Background is a slightly deeper indigo (#4F46E5) than --accent (#6366F1):
  // white text on #6366F1 is only 4.47:1 (fails AA for the sm/md text sizes),
  // while on #4F46E5 it clears ~5.9:1. The focus ring still uses --accent so the
  // brand color and ring stay consistent across the app.
  primary:
    "bg-[#4F46E5] text-white shadow-[0_8px_32px_-8px_var(--accent-glow)] " +
    "hover:bg-[#4F46E5]/90 active:bg-[#4F46E5]",
  secondary:
    "bg-surface text-foreground border border-border " +
    "hover:bg-white/10 active:bg-white/[0.07]",
  ghost:
    "bg-transparent text-foreground-muted " +
    "hover:bg-surface hover:text-foreground active:bg-white/[0.04]",
  danger:
    "bg-destructive text-white shadow-[0_8px_32px_-8px_rgba(248,113,113,0.4)] " +
    "hover:bg-destructive/90 active:bg-destructive",
};

// md/lg are >= 44px tall to satisfy touch-target guidance.
const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-base",
};

const spinnerSize: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 19 };

/**
 * Button — primary interactive control.
 *
 * Variants: primary (accent + glow), secondary (glass), ghost (text), danger.
 * Sizes: sm | md | lg. `loading` swaps content for a spinner and disables.
 * Press feedback scales to 0.97 (gated behind prefers-reduced-motion).
 * Forwards ref to the underlying <button> and spreads remaining props.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const reduceMotion = useReducedMotion();
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        whileTap={reduceMotion || isDisabled ? undefined : { scale: 0.97 }}
        className={cn(
          base,
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {loading && (
          <Loader2
            size={spinnerSize[size]}
            className="animate-spin"
            aria-hidden="true"
          />
        )}
        {!loading && leftIcon}
        {children}
        {!loading && rightIcon}
      </motion.button>
    );
  },
);
