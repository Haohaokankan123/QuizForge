"use client";

import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
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
}

/**
 * Textarea — dark, labeled multi-line field.
 *
 * Same accessibility contract as Input: visible <label htmlFor> tied to the
 * textarea id, helper/error text below, aria-invalid + aria-describedby on
 * error, accent focus ring. Defaults to 4 rows and vertical-only resize.
 * Forwards ref to <textarea> and spreads rest props.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      helperText,
      error,
      hideLabel = false,
      id,
      rows = 4,
      className,
      disabled,
      required,
      ...rest
    },
    ref,
  ) {
    const autoId = useId();
    const textareaId = id ?? autoId;
    const describedById = `${textareaId}-desc`;
    const hasError = Boolean(error);
    const message = error ?? helperText;

    return (
      <div className="flex w-full flex-col gap-1.5">
        <label
          htmlFor={textareaId}
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

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={message ? describedById : undefined}
          className={cn(
            "w-full resize-y rounded-2xl border bg-bg-elevated px-4 py-3 text-sm text-foreground",
            "placeholder:text-foreground-muted",
            "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
            "disabled:cursor-not-allowed disabled:opacity-50",
            hasError
              ? "border-destructive focus-visible:ring-destructive"
              : "border-border focus-visible:ring-accent focus-visible:border-accent",
            className,
          )}
          {...rest}
        />

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
  },
);
