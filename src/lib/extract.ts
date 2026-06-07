/**
 * Client-side content extraction for QuizForge.
 *
 * WHAT THIS FILE DOES
 * -------------------
 * It takes a file the user uploaded in their browser (.txt, .pdf, or .docx) and
 * turns it into plain text. All of this happens in the BROWSER — nothing is sent
 * to a server here. That keeps the user's documents private and avoids any upload
 * step before they even generate a quiz.
 *
 * WHY DYNAMIC IMPORTS
 * -------------------
 * The PDF library (pdfjs-dist) and the DOCX library (mammoth) are large and only
 * run in the browser. We use `await import(...)` (a "dynamic import") instead of a
 * normal top-of-file `import`. Two reasons:
 *   1. Bundle size: the heavy code is only downloaded when a user actually picks a
 *      PDF or DOCX, not on the first page load.
 *   2. SSR safety: Next.js may try to evaluate this module on the server while
 *      rendering. These libraries expect browser globals (like `window` and
 *      `Worker`). Loading them lazily, inside the functions, means they never run
 *      during server-side rendering. That is why this file is "use client" safe.
 *
 * EXPORTS
 * -------
 *   extractText(file): Promise<{ text, sourceType }>  // the main entry point
 *   MAX_CHARS                                          // hard cap on output length
 */

'use client';

/**
 * Safety cap on how many characters we return.
 *
 * WHY: the extracted text is later sent to an AI model to generate a quiz. Very
 * long inputs cost more, run slower, and can exceed the model's limits. If a
 * document is bigger than this, we keep the first MAX_CHARS characters and append
 * a short note so the user knows it was shortened.
 */
export const MAX_CHARS = 100000;

/** A short note appended to text that had to be cut down to MAX_CHARS. */
const TRUNCATION_NOTE =
  '\n\n[Note: This document was longer than the supported limit and was ' +
  'truncated. Only the first part of the text is included.]';

/**
 * The file kinds we can read. This matches the `source_type` values in the shared
 * Quiz type, minus 'text' (typed-in text) and 'youtube' (handled elsewhere).
 */
type FileSourceType = 'txt' | 'pdf' | 'docx';

/**
 * Extract plain text from an uploaded file in the browser.
 *
 * @param file - the File object from an <input type="file"> or a drag-and-drop.
 * @returns the cleaned text plus which source type it came from.
 * @throws a friendly Error if the file type is not supported or extraction fails.
 */
export async function extractText(
  file: File,
): Promise<{ text: string; sourceType: FileSourceType }> {
  // Figure out what kind of file this is from its name/MIME type.
  const sourceType = detectSourceType(file);

  // Pick the right reader for that type. Each reader returns raw text.
  let rawText: string;
  switch (sourceType) {
    case 'txt':
      rawText = await extractFromTxt(file);
      break;
    case 'pdf':
      rawText = await extractFromPdf(file);
      break;
    case 'docx':
      rawText = await extractFromDocx(file);
      break;
  }

  // Clean up whitespace and enforce the character cap before returning.
  const text = normalizeAndCap(rawText);

  return { text, sourceType };
}

/* -------------------------------------------------------------------------- */
/*  Type detection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a file is txt / pdf / docx.
 *
 * We check the file EXTENSION first (e.g. "notes.pdf" -> "pdf") because it is the
 * most reliable signal across browsers. We fall back to the MIME type (the
 * browser's guess at the content, like "application/pdf") if the extension is
 * missing or unhelpful.
 *
 * @throws a friendly Error for anything we cannot handle (e.g. .doc, .pptx, .png).
 */
function detectSourceType(file: File): FileSourceType {
  // Get the part after the last dot, lowercased. "" if there is no extension.
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase();

  // --- Plain text ---
  if (extension === 'txt' || mime === 'text/plain') {
    return 'txt';
  }

  // --- PDF ---
  if (extension === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }

  // --- Word .docx (the modern XML-based Word format) ---
  // The official MIME type for .docx is this long string.
  const DOCX_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'docx' || mime === DOCX_MIME) {
    return 'docx';
  }

  // --- Anything else: give a clear, human error. ---
  // We call out the old .doc format specifically since users often try it.
  if (extension === 'doc' || mime === 'application/msword') {
    throw new Error(
      'Old Word ".doc" files are not supported. Please save it as ".docx" ' +
        'and try again.',
    );
  }

  throw new Error(
    `Unsupported file type "${file.name}". Please upload a .txt, .pdf, or ` +
      '.docx file.',
  );
}

/* -------------------------------------------------------------------------- */
/*  .txt extraction                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Read a plain-text file.
 *
 * The browser's File object has a built-in `.text()` method that returns all the
 * file's contents as a string. Nothing else needed for .txt.
 */
async function extractFromTxt(file: File): Promise<string> {
  return file.text();
}

/* -------------------------------------------------------------------------- */
/*  .pdf extraction (pdfjs-dist)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read a PDF and concatenate the text from every page.
 *
 * HOW PDF.JS WORKS HERE
 * ---------------------
 * pdfjs-dist parses the PDF in a Web Worker (a background thread) so the page
 * stays responsive. We must tell it where that worker file lives by setting
 * `GlobalWorkerOptions.workerSrc`. We point it at the worker that ships inside the
 * installed package using `new URL(..., import.meta.url)`, which lets the bundler
 * (Turbopack / webpack) resolve and serve the worker file correctly in the
 * browser.
 *
 * IMPORTANT — SCANNED PDFs
 * ------------------------
 * This only extracts text that is stored AS TEXT inside the PDF. A scanned
 * document (a photo/image of a page) has no real text layer, so it will yield
 * little or no output. There is no OCR (image-to-text) in v1. If a PDF returns
 * empty text, it is most likely a scanned/image-only PDF.
 */
async function extractFromPdf(file: File): Promise<string> {
  // Load the PDF library only now (browser-only, large). See top-of-file note.
  const pdfjs = await import('pdfjs-dist');

  // Tell pdf.js where its background worker script is. We resolve the worker file
  // that ships in the pdfjs-dist package relative to this module so the bundler
  // includes it and hands the browser a valid URL.
  // `.toString()` turns the URL object into the plain string workerSrc expects.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  // Turn the uploaded file into raw bytes that pdf.js can read.
  // arrayBuffer() gives us the file's binary contents; Uint8Array wraps those
  // bytes in the typed array pdf.js's `data` option expects.
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Start loading/parsing the document. This returns a "loading task" whose
  // `.promise` resolves to the parsed PDF.
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  // Collect each page's text, in order.
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);

    // getTextContent() returns an object whose `items` array holds text chunks.
    // Each chunk has a `.str` field with the actual characters for that chunk.
    const content = await page.getTextContent();
    const strings = content.items
      // Some items can be "marked content" markers without a `str`. Guard with
      // an `in` check so TypeScript and runtime both stay safe.
      .map((item) => ('str' in item ? item.str : ''))
      .filter((s) => s.length > 0);

    pageTexts.push(strings.join(' '));

    // Free the memory pdf.js used for this page before moving to the next one.
    page.cleanup();
  }

  // Separate pages by a newline so page boundaries are visible in the output.
  return pageTexts.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  .docx extraction (mammoth)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Read a Word .docx file and return its plain text.
 *
 * We import from 'mammoth' (the main entry). mammoth ships a "browser" field in
 * its package.json that tells the bundler to automatically swap its two
 * server-only internals (file unzip + file reading) for browser-safe versions.
 * So this single import is browser-safe AND carries TypeScript types — unlike
 * the raw 'mammoth/mammoth.browser' file, which has no type declarations.
 *
 * `extractRawText({ arrayBuffer })` pulls just the document's words (no styling,
 * no HTML) — exactly what we want to feed an AI model.
 */
async function extractFromDocx(file: File): Promise<string> {
  // Load mammoth only now (heavy + browser-only). See top-of-file note.
  // `.default` is mammoth's CommonJS export, accessed via interop on import().
  const mammoth = (await import('mammoth')).default;

  // mammoth needs the file's raw bytes as an ArrayBuffer.
  const arrayBuffer = await file.arrayBuffer();

  // extractRawText returns { value: string, messages: [...] }. `value` is the
  // text; `messages` are warnings we don't need to surface in v1.
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/* -------------------------------------------------------------------------- */
/*  Cleanup + safety cap                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tidy up extracted text and enforce MAX_CHARS.
 *
 * Steps:
 *   1. Normalize line endings (Windows "\r\n" and old Mac "\r" -> "\n").
 *   2. Collapse runs of 3+ blank lines down to a single blank line.
 *   3. Collapse runs of spaces/tabs into one space.
 *   4. Trim leading/trailing whitespace.
 *   5. If still longer than MAX_CHARS, cut it and append the truncation note.
 */
function normalizeAndCap(input: string): string {
  let text = input
    // 1. Unify line endings.
    .replace(/\r\n?/g, '\n')
    // 2. Three or more newlines (lots of blank lines) -> two newlines.
    .replace(/\n{3,}/g, '\n\n')
    // 3. Multiple spaces/tabs -> a single space (does not touch newlines).
    .replace(/[ \t]{2,}/g, ' ')
    // 4. Remove leading/trailing whitespace on the whole string.
    .trim();

  // 5. Enforce the hard cap. We reserve room so the final string (text + note)
    // never exceeds MAX_CHARS.
  if (text.length > MAX_CHARS) {
    const keep = MAX_CHARS - TRUNCATION_NOTE.length;
    text = text.slice(0, keep).trimEnd() + TRUNCATION_NOTE;
  }

  return text;
}
