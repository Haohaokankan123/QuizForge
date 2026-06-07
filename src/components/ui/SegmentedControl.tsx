"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  /** The value committed to onChange when this segment is selected. */
  value: T;
  /** Visible label. */
  label: ReactNode;
  /** Disable this single segment. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** The options to choose from. */
  options: SegmentedOption<T>[];
  /** Currently selected value (controlled). */
  value: T;
  /** Called with the new value when the selection changes. */
  onChange: (value: T) => void;
  /** Accessible group name (e.g. "Difficulty"). Required for screen readers. */
  ariaLabel: string;
  /** Segment height. md/lg meet the 44px touch target. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Stretch each segment to fill the row equally. @default true */
  fullWidth?: boolean;
  /** Disable the entire control. */
  disabled?: boolean;
  /** Extra classes for the outer container. */
  className?: string;
}

const sizeStyles = {
  sm: "h-9 text-sm",
  md: "h-11 text-sm",
  lg: "h-12 text-base",
} as const;

/**
 * SegmentedControl — accessible single-select toggle group.
 *
 * Use for choosing difficulty, question counts, or any small mutually-exclusive
 * set. Implements WAI-ARIA radiogroup semantics: container role="radiogroup",
 * each segment role="radio" + aria-checked. Keyboard: Arrow keys move and
 * select the adjacent (non-disabled) option, Home/End jump to first/last; only
 * the active segment is in the tab order (roving tabindex). The selected pill
 * slides between options via a shared layoutId (disabled under
 * prefers-reduced-motion).
 *
 * Generic over the value type so onChange is strongly typed:
 *   <SegmentedControl<Difficulty> ... />
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  fullWidth = true,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const reduceMotion = useReducedMotion();
  const layoutGroupId = useId();

  const enabledIndexes = options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i !== -1);

  function selectByOffset(currentIndex: number, dir: 1 | -1) {
    if (enabledIndexes.length === 0) return;
    const pos = enabledIndexes.indexOf(currentIndex);
    const nextPos =
      pos === -1
        ? 0
        : (pos + dir + enabledIndexes.length) % enabledIndexes.length;
    const nextIndex = enabledIndexes[nextPos];
    onChange(options[nextIndex].value);
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (disabled) return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selectByOffset(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        selectByOffset(index, -1);
        break;
      case "Home":
        e.preventDefault();
        if (enabledIndexes.length) onChange(options[enabledIndexes[0]].value);
        break;
      case "End":
        e.preventDefault();
        if (enabledIndexes.length)
          onChange(options[enabledIndexes[enabledIndexes.length - 1]].value);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex gap-1 rounded-2xl border border-border bg-bg-elevated p-1",
        fullWidth && "flex w-full",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const isDisabled = disabled || option.disabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={isDisabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => !isDisabled && onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "relative inline-flex flex-1 items-center justify-center rounded-xl px-3 font-medium",
              "cursor-pointer select-none whitespace-nowrap",
              "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
              "disabled:cursor-not-allowed disabled:opacity-50",
              sizeStyles[size],
              selected
                ? "text-white"
                : "text-foreground-muted hover:text-foreground",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`${layoutGroupId}-thumb`}
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-accent shadow-[0_8px_24px_-10px_var(--accent-glow)]"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
