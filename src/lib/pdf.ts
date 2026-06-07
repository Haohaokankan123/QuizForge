/**
 * PDF export for QuizForge quizzes.
 *
 * Builds a clean, text-based PDF from a Quiz using jsPDF — no html2canvas, no
 * DOM rendering, so it stays lightweight and crisp (real text, not a bitmap).
 *
 * Design choices:
 * - jsPDF is loaded via a dynamic import("jspdf") so the (large) library is
 *   kept out of the server bundle and only fetched when a user actually exports.
 *   This file is therefore browser-only at call time.
 * - Layout is laid out manually with a running y-cursor; when the cursor would
 *   overflow the page we call addPage() and reset to the top margin.
 * - For multiple_choice / true_false we list the options lettered A/B/C/D…
 * - With { includeAnswers: true } an "Answer key" section is appended at the end
 *   listing each question's correct answer plus a brief explanation.
 *
 * Public API:
 *   exportQuizToPdf(quiz, { includeAnswers })  -> triggers a browser download
 *     of "<sanitized title>.pdf".
 */

import type { Quiz, Question } from "@/lib/types";

/** Options controlling what the exported PDF contains. */
export interface ExportQuizPdfOptions {
  /** When true, append an answer key (answer + brief explanation) at the end. */
  includeAnswers?: boolean;
}

// --- Page geometry (mm; jsPDF default unit). A4 portrait. ---------------------
const MARGIN_X = 18; // left/right margin
const MARGIN_TOP = 20; // top margin
const MARGIN_BOTTOM = 18; // bottom margin (cursor must stay above this)

// --- Type scale (pt) ----------------------------------------------------------
const FONT_TITLE = 20;
const FONT_HEADING = 13;
const FONT_BODY = 11;
const FONT_SMALL = 9.5;

// Line height as a multiple of font size, converted pt -> mm (1pt = 0.3528mm).
const PT_TO_MM = 0.3528;
const LINE_FACTOR = 1.35;

/** A→Z label for an option index (0 -> "A", 1 -> "B", …). */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Turn a quiz title into a safe filename stem. Strips characters that are
 * illegal/awkward in filenames, collapses whitespace to single dashes, trims,
 * and falls back to "quiz" when nothing usable remains.
 */
export function sanitizeFilename(title: string): string {
  const cleaned = (title || "")
    .replace(/[\\/:*?"<>|]+/g, " ") // illegal filename chars -> space
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "quiz";
}

/** True for question types that present a fixed list of options to letter. */
function hasOptions(q: Question): boolean {
  return (
    (q.type === "multiple_choice" || q.type === "true_false") &&
    Array.isArray(q.options) &&
    q.options.length > 0
  );
}

/**
 * Export a quiz to a downloadable PDF.
 *
 * @param quiz  The quiz to render.
 * @param opts  { includeAnswers } — when true, appends an answer-key section.
 *
 * Browser-only: dynamically imports jsPDF and triggers a file download. Resolves
 * once the file has been handed to the browser. No-ops with a thrown error if
 * called on the server (there is no window/jsPDF there).
 */
export async function exportQuizToPdf(
  quiz: Quiz,
  opts: ExportQuizPdfOptions = {},
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("exportQuizToPdf can only run in the browser.");
  }

  const { includeAnswers = false } = opts;

  // Dynamic import keeps jsPDF out of the server bundle and out of the initial
  // client bundle until an export is actually requested.
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_X * 2;

  // Running vertical cursor (mm from top of page).
  let y = MARGIN_TOP;

  /** mm height of one line at the given font size. */
  const lineHeight = (fontSize: number): number =>
    fontSize * PT_TO_MM * LINE_FACTOR;

  /** Start a fresh page and reset the cursor to the top margin. */
  const newPage = (): void => {
    doc.addPage();
    y = MARGIN_TOP;
  };

  /** Ensure `needed` mm fit before the bottom margin; page-break if not. */
  const ensureSpace = (needed: number): void => {
    if (y + needed > pageHeight - MARGIN_BOTTOM) newPage();
  };

  /**
   * Write wrapped text at the current cursor and advance y. Handles its own
   * page breaks line-by-line so long blocks split cleanly across pages.
   */
  const writeWrapped = (
    text: string,
    fontSize: number,
    style: "normal" | "bold" | "italic" = "normal",
    indent = 0,
    color: [number, number, number] = [17, 17, 17],
  ): void => {
    doc.setFont("helvetica", style);
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);

    const maxWidth = contentWidth - indent;
    const lines: string[] = doc.splitTextToSize(text, maxWidth);
    const lh = lineHeight(fontSize);

    for (const line of lines) {
      ensureSpace(lh);
      doc.text(line, MARGIN_X + indent, y);
      y += lh;
    }
  };

  /** Add vertical spacing (mm), page-breaking if it would overflow. */
  const gap = (mm: number): void => {
    ensureSpace(mm);
    y += mm;
  };

  // --- Title -----------------------------------------------------------------
  writeWrapped(quiz.title || "Quiz", FONT_TITLE, "bold");
  gap(2);

  // Subtle metadata line (difficulty + question count).
  const meta = `Difficulty: ${quiz.difficulty} · ${quiz.questions.length} question${
    quiz.questions.length === 1 ? "" : "s"
  }`;
  writeWrapped(meta, FONT_SMALL, "normal", 0, [110, 110, 110]);
  gap(6);

  // --- Questions -------------------------------------------------------------
  quiz.questions.forEach((q, i) => {
    // Keep at least the prompt's first couple of lines together with its number.
    ensureSpace(lineHeight(FONT_BODY) * 2);

    writeWrapped(`${i + 1}. ${q.prompt}`, FONT_BODY, "bold");

    if (hasOptions(q)) {
      gap(1);
      q.options!.forEach((opt, oi) => {
        writeWrapped(`${optionLetter(oi)}. ${opt}`, FONT_BODY, "normal", 6);
      });
    } else {
      // fill_blank / short_answer: leave a visible answer line for print.
      gap(1);
      writeWrapped("Answer: ______________________________", FONT_SMALL, "normal", 6, [
        150, 150, 150,
      ]);
    }

    gap(5);
  });

  // --- Answer key (optional) -------------------------------------------------
  if (includeAnswers) {
    gap(4);
    // Start the key on a fresh page if very little room remains.
    ensureSpace(lineHeight(FONT_HEADING) * 3);
    writeWrapped("Answer key", FONT_HEADING, "bold", 0, [70, 70, 200]);
    gap(3);

    quiz.questions.forEach((q, i) => {
      ensureSpace(lineHeight(FONT_BODY) * 2);
      writeWrapped(`${i + 1}. ${q.answer}`, FONT_BODY, "bold");
      if (q.explanation) {
        writeWrapped(q.explanation, FONT_SMALL, "italic", 6, [90, 90, 90]);
      }
      gap(3);
    });
  }

  // --- Page numbers (footer) -------------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT_SMALL);
    doc.setTextColor(160, 160, 160);
    doc.text(
      `${p} / ${pageCount}`,
      pageWidth - MARGIN_X,
      pageHeight - 8,
      { align: "right" },
    );
  }

  doc.save(`${sanitizeFilename(quiz.title)}.pdf`);
}
