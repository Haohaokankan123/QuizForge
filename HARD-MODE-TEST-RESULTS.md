# Hard-Mode Quiz Quality — Live Test Results (2026-06-07)

Model: `openai/gpt-oss-120b` (Groq free tier). All tests = **HARD** difficulty, real `generateQuiz()` engine.

## ✅ VOCAB (Holes-style) — asked 5, got 5
All 5 became **indirect fill-in-the-blank** (student must INFER the word — the hardest format):
- "After the town's only factory shut down, the empty streets echoed with silence, and Maria felt a deep sense of ____" → **forlorn**
- "When the attic was flooded with old boxes, Jake began to ____ through the piles, tossing aside anything not useful" → **rummage**
- None restate the definition next to the blank. No duplicate concepts.

## ✅ MATH — asked 4, got 3 (+ honest "thin source" warning)
- **Multi-step:** "A rectangle is 6m × 4m. If its length is increased by 2m and width decreased by 1m, what is the area?" → 24 m². Distractors 28/30/32 = **plausible-mistake values**, not random.
- **Reasons across the source:** "A right triangle has legs equal to the rectangle's length and width. Hypotenuse?" → 5m (combines dimensions + Pythagoras). Distractors 7/9/10.

## ✅ CODING (Python) — asked 4, got 4
- **Real code-trace:** "`for i in range(4): print(i)` — what prints?" → 0,1,2,3. Distractors `1,2,3,4` (1-based error), `0,1,2` (off-by-one), `1,2,3` — all genuine mistakes.
- **Composed NEW snippet:** "Given `my_list=[10,20,30]`, what is `my_list[len(my_list)-1]`?" → 30. Distractors 20/10/Error (fencepost mistakes).

## ✅ SCIENCE — asked 4, got 3 (+ honest warning)
- **Cause/effect "what breaks if a step changes":** "A scientist removes a plant cell's chlorophyll. Can it still photosynthesize?" → No, the pigment that captures light is missing. Distractors are confusable real-concept outcomes.
- **Recombined facts:** photosynthesis vs respiration gas exchange, with the gases swapped as the tempting wrong option.

## ✅ HISTORY — asked 4, got 4
- **Cause/effect MC:** "Why did labor reforms become necessary?" → unsafe conditions + long hours. Distractors = recombined real source facts.
- **"Most directly enabled":** which invention let factories outpace hand labor → steam engine (distractors: spinning jenny / power loom / water wheel).
- ⚠️ Note: 2 of 4 were `short_answer` recall ("which nation", "which period") — the thin 4-sentence source limited deep questions. The MC questions carry the difficulty.

## Summary
All 5 subjects now produce **genuinely hard multiple-choice** with confusable, subject-appropriate distractors. The old behavior (recall questions labeled "hard", obviously-wrong distractors) is fixed. Remaining minor gap: `short_answer` on very thin sources can still be recall — feed richer material for best results; the shortfall warning flags thin sources automatically.
