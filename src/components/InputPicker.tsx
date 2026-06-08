"use client";

/**
 * InputPicker — four ways to provide study content.
 *
 * Lets the user supply the source for a quiz via a tabbed interface:
 *   1. Paste text   — a controlled Textarea with a char counter.
 *   2. Upload file  — drag-and-drop / click one OR MORE .txt/.pdf/.docx files;
 *                     each is extracted in-browser, kept as a removable chip, and
 *                     all of their text is merged (joined with blank lines) into
 *                     the single content string reported up. A "Take/Upload photo"
 *                     affordance also lives here: it reads an image and POSTs it to
 *                     /api/vision (server OCR) and uses the returned text.
 *   3. YouTube      — paste a URL; POSTs to /api/youtube to fetch the transcript.
 *   4. Describe (AI)— describe the topic/test in words (no upload needed) plus an
 *                     optional notes box. The AI may use its OWN knowledge here.
 *
 * CONTROLLED COMPONENT
 * --------------------
 * The PARENT owns the resulting content text and its source type. This component
 * only reports changes up via `onChange` (the merged/typed text),
 * `onSourceTypeChange` (which input produced it), and — for the AI tab —
 * `onTopicChange` + `onUseOwnKnowledgeChange`. It also reports the active tab via
 * `onActiveTabChange` so the parent can show the right "describe anything" box and
 * decide the source type for the AI case. It keeps purely-local UI state for the
 * active tab, the file list, photo/file/transcript loading + success + error, and
 * the YouTube URL field.
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
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Camera,
  ChevronDown,
  X,
} from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SourceType } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/*  Public contract                                                           */
/* -------------------------------------------------------------------------- */

/** The four tabs. Exported so the parent can react to the active tab. */
export type InputTab = "paste" | "upload" | "youtube" | "ai";

export interface InputPickerProps {
  /** Current content text (controlled by the parent). */
  value: string;
  /** Called when the content text changes (typing, extraction, or transcript). */
  onChange: (text: string) => void;
  /** Report which source produced the current text. */
  onSourceTypeChange: (s: SourceType) => void;
  /**
   * Called whenever a file/transcript/photo extraction starts (true) or finishes
   * (false). The parent uses this to BLOCK "Generate" while text is still being
   * read, so a quiz can never be made from stale (previous) content before the
   * new source finishes reading.
   */
  onExtractingChange?: (extracting: boolean) => void;
  /** Report which tab is active, so the parent can show the right controls. */
  onActiveTabChange?: (tab: InputTab) => void;
  /** AI tab: report the topic/test description the user typed. */
  onTopicChange?: (topic: string) => void;
  /** AI tab: report whether the model may use its own knowledge. */
  onUseOwnKnowledgeChange?: (useOwn: boolean) => void;
  /** Soft cap on characters for the counters. @default 100000 */
  maxChars?: number;
  /** Disable all inputs (e.g. while the parent is generating). */
  disabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Local types + constants                                                   */
/* -------------------------------------------------------------------------- */

const TABS: { id: InputTab; label: string; icon: typeof ClipboardPaste }[] = [
  { id: "paste", label: "Paste text", icon: ClipboardPaste },
  { id: "upload", label: "Upload file", icon: Upload },
  { id: "youtube", label: "YouTube", icon: Video },
  { id: "ai", label: "Describe (AI)", icon: Sparkles },
];

const DEFAULT_MAX_CHARS = 100_000;

/** One extracted upload, kept so we can show a chip and re-merge on removal. */
interface UploadedFile {
  /** Stable id so React keys + removal don't depend on (possibly duplicate) names. */
  id: string;
  name: string;
  /** Characters this file contributed. */
  chars: number;
  /** The extracted text (merged into the parent's content). */
  text: string;
}

/** Result of a successful transcript fetch, kept for the success card. */
interface TranscriptResult {
  title?: string;
  chars: number;
}

/** Result of a successful photo OCR, kept for the success card. */
interface PhotoResult {
  chars: number;
}

/** Shape we accept from /api/youtube. All fields optional/defensive. */
interface YoutubeResponse {
  text?: string;
  title?: string;
  error?: string;
}

/** Shape we accept from /api/vision. All fields optional/defensive. */
interface VisionResponse {
  text?: string;
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
  onActiveTabChange,
  onTopicChange,
  onUseOwnKnowledgeChange,
  maxChars = DEFAULT_MAX_CHARS,
  disabled = false,
}: InputPickerProps) {
  const reduceMotion = useReducedMotion();

  // ---- Tab state + a11y ids ----
  const [activeTab, setActiveTab] = useState<InputTab>("paste");
  const baseId = useId();
  const tabId = (id: InputTab) => `${baseId}-tab-${id}`;
  const panelId = (id: InputTab) => `${baseId}-panel-${id}`;
  const tabRefs = useRef<Record<InputTab, HTMLButtonElement | null>>({
    paste: null,
    upload: null,
    youtube: null,
    ai: null,
  });

  /**
   * Switch tabs. Crucially this RESETS both the parent-owned content/topic and
   * this component's own per-tab local state, so the data sent to /api/generate
   * always matches the ACTIVE tab — no stale text from a previous tab leaks
   * through (which would mis-source the quiz or feed old text as AI "notes").
   */
  function selectTab(id: InputTab) {
    if (id === activeTab) return; // re-clicking the current tab is a no-op
    setActiveTab(id);
    onActiveTabChange?.(id);

    // Reset parent-owned values to the new tab's neutral baseline.
    onChange("");
    onTopicChange?.("");
    onSourceTypeChange(id === "ai" ? "ai" : "text");
    onUseOwnKnowledgeChange?.(true);

    // Reset all local per-tab UI state so nothing can re-leak from another tab.
    setTopic("");
    setNotes("");
    setNotesOpen(false);
    setUrl("");
    setFiles([]);
    setOverflowFile(null);
    setFileError(null);
    setYtResult(null);
    setYtError(null);
    setPhotoResult(null);
    setPhotoError(null);
  }

  // ---- Upload state (multi-file) ----
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  /** Name of the file whose addition pushed the merged total over the cap (if any). */
  const [overflowFile, setOverflowFile] = useState<string | null>(null);

  // ---- Photo state ----
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoResult | null>(null);

  // ---- YouTube state ----
  const [url, setUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytResult, setYtResult] = useState<TranscriptResult | null>(null);

  // ---- AI (Describe) state ----
  const [topic, setTopic] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  // ---- Derived (paste / counters) ----
  const overLimit = value.length > maxChars;
  // Approximate word count (people think in words, not characters). Empty -> 0.
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  // The character cap, expressed roughly in words (~6 chars/word incl. spaces),
  // so the label is honest about what fits.
  const maxWordsApprox = Math.round(maxChars / 6);

  /* ---------------------------------------------------------------------- */
  /*  Tab keyboard navigation (roving tabindex)                             */
  /* ---------------------------------------------------------------------- */

  function focusTab(id: InputTab) {
    selectTab(id);
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
  /*  Upload handlers (multi-file)                                          */
  /* ---------------------------------------------------------------------- */

  /** Re-merge a file list into one content string and report it (text + count). */
  function commitFiles(list: UploadedFile[]) {
    const merged = list.map((f) => f.text).join("\n\n");
    onChange(merged);
    onSourceTypeChange(list.length > 0 ? "txt" : "text");
  }

  /** Extract one or more chosen files, append them as chips, and merge their text. */
  async function processFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    if (list.length === 0) return;

    setFileError(null);
    setOverflowFile(null);
    setFileLoading(true);
    onExtractingChange?.(true);

    // Build the next list on top of whatever's already accepted so multiple
    // drops/selections accumulate rather than replace.
    const next = [...files];
    const errors: string[] = [];
    // Track the first file that tips the merged total over the cap, in a PLAIN
    // local (not state — state wouldn't update mid-loop). Seed it from whether
    // the existing list was already over.
    const merged = (l: UploadedFile[]) => l.map((f) => f.text).join("\n\n").length;
    let alreadyOver = merged(next) > maxChars;
    let culprit: string | null = null;

    try {
      // Dynamic import keeps the heavy pdf/docx libs out of the initial bundle.
      const { extractText } = await import("@/lib/extract");
      for (const file of list) {
        try {
          const { text } = await extractText(file);
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            chars: text.length,
            text,
          });
          // The FIRST file that crosses the cap (when we weren't already over)
          // is the culprit we surface to the user.
          if (!alreadyOver && merged(next) > maxChars) {
            culprit = file.name;
            alreadyOver = true;
          }
        } catch (err) {
          errors.push(
            err instanceof Error
              ? `${file.name}: ${err.message}`
              : `${file.name}: couldn't be read.`,
          );
        }
      }

      setFiles(next);
      setOverflowFile(culprit);
      commitFiles(next);
      if (errors.length > 0) setFileError(errors.join(" "));
    } finally {
      setFileLoading(false);
      onExtractingChange?.(false);
    }
  }

  /** Remove one file chip and re-merge the remaining files. */
  function removeFile(id: string) {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    commitFiles(next);
    // Re-derive WHICH file now tips the merged total over the cap (same walk as
    // processFiles), so the highlight + message never name a stale/removed file.
    let running = "";
    let culprit: string | null = null;
    for (const f of next) {
      running = running ? `${running}\n\n${f.text}` : f.text;
      if (running.length > maxChars) {
        culprit = f.name;
        break;
      }
    }
    setOverflowFile(culprit);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Clear ALL uploaded files + the reported text. */
  function clearAllFiles() {
    setFiles([]);
    setFileError(null);
    setOverflowFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onChange("");
    onSourceTypeChange("text");
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (disabled || fileLoading) return;
    const dropped = e.dataTransfer.files;
    if (dropped && dropped.length > 0) void processFiles(dropped);
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
  /*  Photo handler (camera / image upload -> /api/vision OCR)             */
  /* ---------------------------------------------------------------------- */

  /** Read an image file as a base64 data URL (what the vision route expects). */
  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(new Error("We couldn't read that image. Please try another."));
      reader.readAsDataURL(file);
    });
  }

  async function processPhoto(file: File) {
    if (disabled || photoLoading) return;
    setPhotoError(null);
    setPhotoResult(null);
    setPhotoLoading(true);
    // Anti-stale rule: drop any previous content while we read the photo, and
    // block Generate until the OCR lands.
    onChange("");
    onExtractingChange?.(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data: VisionResponse | null = await res.json().catch(() => null);

      if (!res.ok || !data?.text || !data.text.trim()) {
        const message =
          data?.error ??
          "We couldn't read any text from that photo. Try a clearer, well-lit shot.";
        setPhotoError(message);
        return;
      }

      onChange(data.text);
      onSourceTypeChange("photo");
      setPhotoResult({ chars: data.text.length });
    } catch (err) {
      setPhotoError(
        err instanceof Error
          ? err.message
          : "We couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setPhotoLoading(false);
      onExtractingChange?.(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  function openPhotoDialog() {
    if (disabled || photoLoading) return;
    photoInputRef.current?.click();
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
  /*  AI (Describe) handlers                                                */
  /* ---------------------------------------------------------------------- */

  /** Update the topic locally + report it up. Source type for AI is set on the parent. */
  function handleTopicChange(next: string) {
    setTopic(next);
    onTopicChange?.(next);
    // AI tab always allows the model to use its own knowledge.
    onUseOwnKnowledgeChange?.(true);
  }

  /** Update the optional notes locally + report them as the content for the AI tab. */
  function handleNotesChange(next: string) {
    setNotes(next);
    // For the AI tab, the optional notes ARE the content (may be "").
    onChange(next);
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

  // Merged-total counters for the upload tab.
  // Use the JOINED length (incl. the "\n\n" separators), matching exactly what
  // commitFiles reports up and what the parent's over-limit gate measures — so
  // this counter never disagrees with the parent's banner/Generate state.
  const fileTotalChars = files.map((f) => f.text).join("\n\n").length;

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
              onClick={() => selectTab(id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={cn(
                "relative inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 sm:px-3",
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
              {/* Label hides on the narrowest phones so four nowrap tabs never
                  overflow 375px; the icon + aria-label still identify each tab. */}
              <span className="relative z-10 hidden truncate min-[480px]:inline">
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

      {/* -------- Panel: Upload file (+ photo) -------- */}
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
          {/* Hidden native file input — MULTIPLE files, opened by the dropzone. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            multiple
            className="sr-only"
            disabled={disabled || fileLoading}
            onChange={(e) => {
              const picked = e.target.files;
              if (picked && picked.length > 0) void processFiles(picked);
            }}
          />
          {/* Hidden native image input — opens the camera on phones (capture). */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={disabled || photoLoading}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void processPhoto(picked);
            }}
          />

          {/* Dropzone (always shown so the user can add more files / photos). */}
          <div
            role="button"
            tabIndex={disabled || fileLoading ? -1 : 0}
            aria-disabled={disabled || fileLoading || undefined}
            aria-label="Upload one or more .txt, .pdf, or .docx files. Click or press Enter to browse, or drop files here."
            onClick={openFileDialog}
            onKeyDown={handleDropzoneKeyDown}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center",
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
                  Reading your file{files.length === 0 ? "" : "s"}…
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
                    .txt, .pdf, or .docx — you can add several
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Photo affordance — opens camera on phones, file picker on laptops. */}
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={openPhotoDialog}
              loading={photoLoading}
              disabled={disabled || photoLoading}
              leftIcon={<Camera className="size-4" />}
              className="w-full sm:w-auto"
            >
              {photoLoading ? "Reading your photo…" : "Take or upload a photo"}
            </Button>
            <p className="text-xs text-foreground-muted">
              Snap a page of notes or a textbook — we’ll read the text from it.
            </p>
          </div>

          {/* Photo success */}
          {photoResult && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/10 px-4 py-3"
            >
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Camera className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
                  Photo read
                </p>
                <p className="text-xs text-foreground-muted">
                  Read {photoResult.chars.toLocaleString()} characters from your photo.
                </p>
              </div>
            </div>
          )}

          {/* Photo error */}
          {photoError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
            >
              <AlertCircle
                className="mt-0.5 size-5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">{photoError}</p>
            </div>
          )}

          {/* Accepted files — removable chips with per-file char counts. */}
          {files.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {files.length} file{files.length === 1 ? "" : "s"} added
                </span>
                <button
                  type="button"
                  onClick={clearAllFiles}
                  disabled={disabled}
                  className="text-xs font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base rounded"
                >
                  Clear all
                </button>
              </div>
              <ul className="flex flex-col gap-1.5">
                {files.map((f) => {
                  const isCulprit = overflowFile === f.name;
                  return (
                    <li
                      key={f.id}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2",
                        isCulprit
                          ? "border-destructive/40 bg-destructive/10"
                          : "border-border bg-bg-elevated",
                      )}
                    >
                      <FileText
                        className="size-4 shrink-0 text-foreground-muted"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {f.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
                        {f.chars.toLocaleString()} chars
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => removeFile(f.id)}
                        disabled={disabled}
                        className="grid size-7 shrink-0 place-items-center rounded-lg text-foreground-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Running total vs the cap. */}
              <div className="flex items-center justify-end text-xs">
                <span
                  className={cn(
                    "tabular-nums",
                    fileTotalChars > maxChars
                      ? "font-medium text-destructive"
                      : "text-foreground-muted",
                  )}
                >
                  {fileTotalChars.toLocaleString()}/{maxChars.toLocaleString()} chars total
                </span>
              </div>
              {/* Which file tipped it over (when over). */}
              {overflowFile && (
                <p className="text-xs text-destructive">
                  Adding “{overflowFile}” pushed your material over the limit.
                  Remove a file, or use the trim option below.
                </p>
              )}
            </div>
          )}

          {/* Inline file error */}
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
            Scanned or image-only PDFs may contain no readable text — use the
            photo option for those. Old Word “.doc” files aren’t supported — save
            as “.docx” first.
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

      {/* -------- Panel: Describe (AI) -------- */}
      {activeTab === "ai" && (
        <motion.div
          key="ai"
          {...panelMotion}
          role="tabpanel"
          id={panelId("ai")}
          aria-labelledby={tabId("ai")}
          tabIndex={0}
          className="flex flex-col gap-3 focus-visible:outline-none"
        >
          <Textarea
            label="Describe your test"
            rows={5}
            value={topic}
            disabled={disabled}
            onChange={(e) => handleTopicChange(e.target.value)}
            placeholder="Describe your test: the topic and what to focus on, e.g. 'French Revolution causes, emphasize economic factors'."
            helperText="QuizForge will use its own knowledge of this topic (plus any notes you add) to write the quiz."
          />

          {/* Optional collapsible notes box. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((o) => !o)}
              disabled={disabled}
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-200",
                  notesOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
              Add notes (optional)
            </button>
            {notesOpen && (
              <Textarea
                label="Notes (optional)"
                hideLabel
                rows={6}
                value={notes}
                disabled={disabled}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Paste any extra notes you want the AI to weave in (optional)…"
              />
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
