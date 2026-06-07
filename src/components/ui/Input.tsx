"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Visible label text. Required for accessibility (associated via htmlFor/id). */
  label: string;
  /** Helper text shown below the field when there is no error. */
  helperText?: string;
  /** Error message. When set, the field shows an error state + aria-invalid. */
  error?: string;
  /** Visually hide the label (still read by screen readers). @default false */
  hideLabel?: boolean;
  /** Explicit id; auto-generated via useId() when omitted. */
  id?: string;
  /** Optional adornment rendered inside the field, on the left. */
  leftIcon?: ReactNode;
}

/**
 * Input — dark, labeled text field.
 *
 * Renders a visible <label htmlFor> tied to the input id (auto-generated if not
 * provided). Shows helper text or an error message below; on error it sets
 * aria-invalid, wires aria-describedby to the message, and recolors the border.
 * Focus shows an accent ring. Forwards ref to <input> and spreads rest props.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    hideLabel = false,
    id,
    leftIcon,
    className,
    disabled,
    required,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedById = `${inputId}-desc`;
  const hasError = Boolean(error);
  const message = error ?? helperText;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={cn(
          "text-sm font-medium text-foreground",
          hideLabel && "sr-only",
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div className="relative">
        {leftIcon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={message ? describedById : undefined}
          className={cn(
            "h-11 w-full rounded-2xl border bg-bg-elevated px-4 text-sm text-foreground",
            "placeholder:text-foreground-muted",
            "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
            "disabled:cursor-not-allowed disabled:opacity-50",
            Boolean(leftIcon) && "pl-10",
            hasError
              ? "border-destructive focus-visible:ring-destructive"
              : "border-border focus-visible:ring-accent focus-visible:border-accent",
            className,
          )}
          {...rest}
        />
      </div>

      {message && (
        <p
          id={describedById}
          className={cn(
            "text-xs",
            hasError ? "text-destructive" : "text-foreground-muted",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
});
