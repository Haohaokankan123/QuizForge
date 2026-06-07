"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * AmbientBackground
 *
 * Fixed, full-viewport, non-interactive cinematic backdrop sitting behind all
 * page content. Renders 3 large, heavily-blurred radial-gradient "blobs" in the
 * accent (indigo) and secondary (violet) brand colors at low opacity.
 *
 * Motion: each blob slowly oscillates its position/scale on an independent,
 * easing loop to create a living, premium dark ambience. When the user prefers
 * reduced motion, the blobs render statically (no animation) for accessibility.
 */
export default function AmbientBackground() {
  const reduceMotion = useReducedMotion();

  // Shared blob styling: large, soft, blurred radial gradients.
  const blobBase: React.CSSProperties = {
    position: "absolute",
    borderRadius: "9999px",
    filter: "blur(120px)",
    willChange: "transform",
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Blob 1 — accent indigo, top-left */}
      <motion.div
        style={{
          ...blobBase,
          top: "-12%",
          left: "-8%",
          width: "46vw",
          height: "46vw",
          maxWidth: "640px",
          maxHeight: "640px",
          opacity: 0.16,
          background:
            "radial-gradient(circle at center, var(--accent) 0%, transparent 70%)",
        }}
        animate={
          reduceMotion
            ? undefined
            : { x: [0, 60, -20, 0], y: [0, 40, 80, 0], scale: [1, 1.08, 0.96, 1] }
        }
        transition={{
          duration: 26,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "loop",
        }}
      />

      {/* Blob 2 — secondary violet, bottom-right */}
      <motion.div
        style={{
          ...blobBase,
          bottom: "-15%",
          right: "-10%",
          width: "52vw",
          height: "52vw",
          maxWidth: "720px",
          maxHeight: "720px",
          opacity: 0.13,
          background:
            "radial-gradient(circle at center, var(--secondary) 0%, transparent 70%)",
        }}
        animate={
          reduceMotion
            ? undefined
            : { x: [0, -50, 30, 0], y: [0, -40, -70, 0], scale: [1, 1.1, 0.94, 1] }
        }
        transition={{
          duration: 32,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "loop",
        }}
      />

      {/* Blob 3 — accent indigo, center-right (subtle depth) */}
      <motion.div
        style={{
          ...blobBase,
          top: "30%",
          left: "42%",
          width: "40vw",
          height: "40vw",
          maxWidth: "560px",
          maxHeight: "560px",
          opacity: 0.1,
          background:
            "radial-gradient(circle at center, var(--accent) 0%, transparent 72%)",
        }}
        animate={
          reduceMotion
            ? undefined
            : { x: [0, 40, -30, 0], y: [0, -30, 30, 0], scale: [1, 1.06, 0.98, 1] }
        }
        transition={{
          duration: 38,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "loop",
        }}
      />
    </div>
  );
}
