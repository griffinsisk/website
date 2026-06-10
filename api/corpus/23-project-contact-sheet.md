## Project: Contact Sheet

Live app: https://contact-sheet-three.vercel.app/ · Public repository:
https://github.com/griffinsisk/contact-sheet

A Next.js web app that uses Claude vision to cull large photo sets the way the
photographer would — born from Griffin's own photography workflow, where
sorting hundreds of frames after a shoot meant decision fatigue and lost
evenings.

**Problem.** Generic aesthetic scoring fails photographers because it ignores
intent: a motion-blurred candid is a craft *success* under a film aesthetic
and a craft *failure* on a wildlife shoot. Scoring every frame against
universal "sharp and centered" conventions cuts the best unconventional work
and rescues technically clean but empty frames.

**Architecture.** A two-pass pipeline tuned for cost and quality: a rapid cull
pass (20 photos per batch, downscaled to 512px to cut vision-token cost
~60%) scoring five weighted dimensions (impact, composition, raw quality,
craft execution, story), then a selective deep-review pass (12 per batch at
1024px) producing editorial guidance — role in the set, edit direction, crop
notes, and a recommended sequence. Built on Next.js/React/TypeScript with
Clerk auth, Stripe billing, a bring-your-own-key option that calls Anthropic
directly from the browser, and strict structured-JSON outputs with truncation
repair.

**Key engineering decisions:**

- *Intent-conditional grading.* Eight session intents (documentary, street,
  film, wildlife, landscape, portrait, events, mixed) each rewrite the craft
  rules in the prompt — film mode literally scores clinical sharpness *lower*
  for missing the aesthetic target, while wildlife mode treats a soft eye as
  a hard failure.
- *Taste profiles with guardrails.* A photographer's favorite-photo library
  becomes structured style context, but the model must keep rubric scores
  pure and propose only bounded adjustments (±6 points max), applied in
  application code with hard rules — e.g., taste alignment can never promote
  a frame with no story to the top tier. Style preference can't override
  weak fundamentals.
- *Measured determinism instead of assumed.* A purpose-built harness ran 34
  photos × 5 runs × 2 resolutions (340 API calls) and measured 100% rating
  stability at temperature 0 with overall score standard deviation of 0.10 —
  proving variance wasn't the problem worth engineering against, so effort
  went to cost and UX instead.
- *Regression-tested scoring.* An eval-fixtures harness asserts score ranges,
  rating buckets, profile alignment, and required/forbidden phrases per test
  image on every prompt change, plus ~1,000 lines of unit tests on the
  scoring and guardrail logic and Playwright end-to-end tests on mocked
  responses.
