"use client";

/**
 * InputPicker — three ways to provide study content.
 *
 * Lets the user supply the source text for a quiz via a tabbed interface:
 *   1. Paste text  — a controlled Textarea with a char counter.
 *   2. Upload file — drag-and-drop / click a .txt/.pdf/.docx; extracted in-browser.
 *   3. YouTube     — paste a URL; POSTs to /api/youtube to fetch the transcript.
 *
 * CONTROLLED COMPONENT
 * --------------------
 * The PARENT owns the resulting content text and its source type. This component
 * only reports changes up via `onChange` (the text) and `onSourceTypeChange`
 * (which input produced it). It keeps purely-local UI state for the active tab,
 * file/transcript loading + success + error, and the YouTube URL field.
 *
 * ACCESSIBILITY
 * -------------
 * The tab strip is a real WAI-ARIA tablist: role="tablist" with role="tab"
 * children (aria-selected, roving tabindex, ArrowLeft/Right + Home/End nav) and
 * a role="tabpanel" linked back to its tab. All motion is gated behind
 * useReducedMotion(). Icons are lucide SVGs (no emoji). Touch targets are 44px+.
 */

import { useId, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ClipboardPaste,
  Upload,
  // This lucide-react build has no "Youtube" glyph; "Video" is the closest
  // available icon for the YouTube tab.
  Video,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  X,
} from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/*  Public contract                                                           */
/* -------------------------------------------------------------------------- */

/** Which kind of input produced the current text. Mirrors Quiz['source_type']. */
type SourceType = "text" | "txt" | "pdf" | "docx" | "youtube";

export interface InputPickerProps {
  /** Current content text (controlled by the parent). */
  value: string;
  /** Called when the content text changes (typing, extraction, or transcript). */
  onChange: (text: string) => void;
  /** Report which source produced the current text. */
  onSourceTypeChange: (s: SourceType) => void;
  /**
   * Called whenever a file/transcript extraction starts (true) or finishes
   * (false). The parent uses this to BLOCK "Generate" while text is still being
   * read, so a quiz can never be made from stale (previous) content before the
   * new file finishes extracting.
   */
  onExtractingChange?: (extracting: boolean) => void;
  /** Soft cap on characters for the paste counter. @default 100000 */
  maxChars?: number;
  /** Disable all inputs (e.g. while the parent is generating). */
  disabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Local types + constants                                                   */
/* -------------------------------------------------------------------------- */

/** The three tabs. */
type TabId = "paste" | "upload" | "youtube";

const TABS: { id: TabId; label: string; icon: typeof ClipboardPaste }[] = [
  { id: "paste", label: "Paste text", icon: ClipboardPaste },
  { id: "upload", label: "Upload file", icon: Upload },
  { id: "youtube", label: "YouTube", icon: Video },
];

const DEFAULT_MAX_CHARS = 100_000;

/** Result of a successful file extraction, kept for the success card. */
interface FileResult {
  name: string;
  chars: number;
}

/** Result of a successful transcript fetch, kept for the success card. */
interface TranscriptResult {
  title?: string;
  chars: number;
}

/** Shape we accept from /api/youtube. All fields optional/defensive. */
interface YoutubeResponse {
  text?: string;
  title?: string;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function InputPicker({
  value,
  onChange,
  onSourceTypeChange,
  onExtractingChange,
  maxChars = DEFAULT_MAX_CHARS,
  disabled = false,
}: InputPickerProps) {
  const reduceMotion = useReducedMotion();

  // ---- Tab state + a11y ids ----
  const [activeTab, setActiveTab] = useState<TabId>("paste");
  const baseId = useId();
  const tabId = (id: TabId) => `${baseId}-tab-${id}`;
  const panelId = (id: TabId) => `${baseId}-panel-${id}`;
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    paste: null,
    upload: null,
    youtube: null,
  });

  // ---- Upload state ----
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileResult, setFileResult] = useState<FileResult | null>(null);

  // ---- YouTube state ----
  const [url, setUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytResult, setYtResult] = useState<TranscriptResult | null>(null);

  // ---- Derived (paste tab) ----
  const overLimit = value.length > maxChars;
  // Approximate word count (people think in words, not characters). Empty -> 0.
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  // The character cap, expressed roughly in words (~6 chars/word incl. spaces),
  // so the label is honest about what fits.
  const maxWordsApprox = Math.round(maxChars / 6);

  /* ---------------------------------------------------------------------- */
  /*  Tab keyboard navigation (roving tabindex)                             */
  /* ---------------------------------------------------------------------- */

  function focusTab(id: TabId) {
    setActiveTab(id);
    // Move DOM focus to the newly-selected tab so keyboard users follow along.
    tabRefs.current[id]?.focus();
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusTab(TABS[next].id);
  }

  /* ---------------------------------------------------------------------- */
  /*  Upload handlers                                                       */
  /* ---------------------------------------------------------------------- */

  /** Run the in-browser extractor on a chosen file and report results up. */
  async function processFile(file: File) {
    setFileError(null);
    setFileResult(null);
    setFileLoading(true);
    // Clear any PREVIOUS content the moment a new file is chosen. Without this,
    // the old text (e.g. a prior PDF) lingers in the parent's state while this
    // new file is still being read — and if the user hits Generate during that
    // window, the quiz would be built from the OLD file. Clearing here makes that
    // impossible: there is simply no stale content to submit.
    onChange("");
    onExtractingChange?.(true);
    try {
      // Dynamic import keeps the heavy pdf/docx libs out of the initial bundle.
      const { extractText } = await import("@/lib/extract");
      const { text, sourceType } = await extractText(file);
      onChange(text);
      onSourceTypeChange(sourceType);
      setFileResult({ name: file.name, chars: text.length });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn't read that file. Please try a different one.";
      setFileError(message);
    } finally {
      setFileLoading(false);
      onExtractingChange?.(false);
    }
  }

  /** Clear the extracted file + its reported text. */
  function clearFile() {
    setFileResult(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onChange("");
    onSourceTypeChange("text");
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (disabled || fileLoading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled || fileLoading) return;
    if (!dragActive) setDragActive(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  function openFileDialog() {
    if (disabled || fileLoading) return;
    fileInputRef.current?.click();
  }

  function handleDropzoneKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFileDialog();
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  YouTube handler                                                       */
  /* ---------------------------------------------------------------------- */

  async function fetchTranscript() {
    const trimmed = url.trim();
    if (!trimmed || disabled || ytLoading) return;
    setYtError(null);
    setYtResult(null);
    setYtLoading(true);
    // Same anti-stale rule as file upload: drop any previous content while we
    // fetch the transcript, and block Generate until it lands.
    onChange("");
    onExtractingChange?.(true);
    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data: YoutubeResponse | null = await res
        .json()
        .catch(() => null);

      if (!res.ok || !data?.text) {
        const message =
          data?.error ??
          "We couldn't get a transcript for that video. Make sure it has captions.";
        setYtError(message);
        return;
      }

      onChange(data.text);
      onSourceTypeChange("youtube");
      setYtResult({ title: data.title, chars: data.text.length });
    } catch {
      setYtError(
        "We couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setYtLoading(false);
      onExtractingChange?.(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Motion                                                                */
  /* ---------------------------------------------------------------------- */

  const panelMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
      };

  /* ---------------------------------------------------------------------- */
  /*  Render                                                                */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Choose how to provide your content"
        aria-orientation="horizontal"
        className="flex w-full gap-1 rounded-2xl border border-border bg-bg-elevated p-1"
      >
        {TABS.map(({ id, label, icon: Icon }, index) => {
          const selected = activeTab === id;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              id={tabId(id)}
              role="tab"
              type="button"
              aria-label={label}
              aria-selected={selected}
              aria-controls={panelId(id)}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => setActiveTab(id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={cn(
                "relative inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3",
                "text-sm font-medium whitespace-nowrap select-none cursor-pointer",
                "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected ? "text-white" : "text-foreground-muted hover:text-foreground",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${baseId}-tab-thumb`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl bg-accent shadow-[0_8px_24px_-10px_var(--accent-glow)]"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 380, damping: 32 }
                  }
                />
              )}
              <Icon className="relative z-10 size-4 shrink-0" aria-hidden="true" />
              {/* Label hides on the narrowest phones so three nowrap tabs never
                  overflow 375px; the icon + aria-label still identify each tab. */}
              <span className="relative z-10 hidden truncate min-[420px]:inline">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* -------- Panel: Paste text -------- */}
      {activeTab === "paste" && (
        <motion.div
          key="paste"
          {...panelMotion}
          role="tabpanel"
          id={panelId("paste")}
          aria-labelledby={tabId("paste")}
          tabIndex={0}
          className="flex flex-col gap-2 focus-visible:outline-none"
        >
          <Textarea
            label="Study material"
            hideLabel
            rows={10}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
              onSourceTypeChange("text");
            }}
            placeholder="Paste your lecture notes, textbook section, article, or any text you want to be quizzed on…"
            aria-describedby={`${baseId}-paste-counter`}
          />
          <div
            id={`${baseId}-paste-counter`}
            className="flex items-center justify-end text-xs"
          >
            <span
              className={cn(
                "tabular-nums",
                overLimit
                  ? "font-medium text-destructive"
                  : "text-foreground-muted",
              )}
            >
              {wordCount.toLocaleString()} / ~{maxWordsApprox.toLocaleString()}{" "}
              words
              {/* No opacity multiplier here: stacking opacity-60 on
                  foreground-muted drops contrast to ~2.8:1 (fails AA). The muted
                  color alone (~6:1) already reads as lower-emphasis. */}
              <span className="ml-1">
                ({value.length.toLocaleString()}/{maxChars.toLocaleString()}{" "}
                chars)
              </span>
            </span>
          </div>
        </motion.div>
      )}

      {/* -------- Panel: Upload file -------- */}
      {activeTab === "upload" && (
        <motion.div
          key="upload"
          {...panelMotion}
          role="tabpanel"
          id={panelId("upload")}
          aria-labelledby={tabId("upload")}
          tabIndex={0}
          className="flex flex-col gap-3 focus-visible:outline-none"
        >
          {/* Hidden native file input — opened by click/keyboard on the dropzone. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            className="sr-only"
            disabled={disabled || fileLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processFile(file);
            }}
          />

          {fileResult ? (
            /* Success state */
            <div
              role="status"
              className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/10 px-4 py-3"
            >
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <FileText className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
                  <span className="truncate">{fileResult.name}</span>
                </p>
                <p className="text-xs text-foreground-muted">
                  Read {fileResult.chars.toLocaleString()} characters.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFile}
                disabled={disabled}
                leftIcon={<X className="size-4" />}
              >
                Remove
              </Button>
            </div>
          ) : (
            /* Dropzone */
            <div
              role="button"
              tabIndex={disabled || fileLoading ? -1 : 0}
              aria-disabled={disabled || fileLoading || undefined}
              aria-label="Upload a .txt, .pdf, or .docx file. Click or press Enter to browse, or drop a file here."
              onClick={openFileDialog}
              onKeyDown={handleDropzoneKeyDown}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center",
                "transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
                disabled || fileLoading
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer",
                dragActive
                  ? "border-accent bg-accent/10"
                  : "border-border bg-bg-elevated hover:border-white/15",
              )}
            >
              {fileLoading ? (
                <>
                  <Loader2
                    className="size-6 animate-spin text-accent"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-foreground" aria-live="polite">
                    Reading your file…
                  </p>
                </>
              ) : (
                <>
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-surface">
                    <Upload className="size-5 text-accent" aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">
                      <span className="text-accent">Click to upload</span> or drag
                      and drop
                    </p>
                    <p className="text-xs text-foreground-muted">
                      .txt, .pdf, or .docx
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Inline error */}
          {fileError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
            >
              <AlertCircle
                className="mt-0.5 size-5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">{fileError}</p>
            </div>
          )}

          {/* Helper text */}
          <p className="text-xs text-foreground-muted">
            Scanned or image-only PDFs may contain no readable text. Old Word
            “.doc” files aren’t supported — save as “.docx” first.
          </p>
        </motion.div>
      )}

      {/* -------- Panel: YouTube -------- */}
      {activeTab === "youtube" && (
        <motion.div
          key="youtube"
          {...panelMotion}
          role="tabpanel"
          id={panelId("youtube")}
          aria-labelledby={tabId("youtube")}
          tabIndex={0}
          className="flex flex-col gap-3 focus-visible:outline-none"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="YouTube URL"
                hideLabel
                type="url"
                inputMode="url"
                value={url}
                disabled={disabled || ytLoading}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void fetchTranscript();
                  }
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                leftIcon={<Video className="size-4" />}
              />
            </div>
            <Button
              onClick={() => void fetchTranscript()}
              loading={ytLoading}
              disabled={disabled || !url.trim()}
              className="sm:w-auto"
            >
              {ytLoading ? "Fetching transcript…" : "Get transcript"}
            </Button>
          </div>

          {/* Success */}
          {ytResult && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/10 px-4 py-3"
            >
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {ytResult.title ?? "Transcript ready"}
                </p>
                <p className="text-xs text-foreground-muted">
                  Loaded {ytResult.chars.toLocaleString()} characters.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {ytError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
            >
              <AlertCircle
                className="mt-0.5 size-5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">{ytError}</p>
            </div>
          )}

          {/* Helper text */}
          <p className="text-xs text-foreground-muted">
            Only works on videos that have captions (most do). We use the
            video’s caption track — no audio is transcribed.
          </p>
        </motion.div>
      )}
    </div>
  );
}
