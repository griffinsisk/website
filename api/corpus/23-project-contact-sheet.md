## Project: Contact Sheet

A Next.js web app that uses Claude vision to cull and score large photo sets
with intent-aware scoring — born from Griffin's own photography workflow.
After a shoot he dreaded sorting through hundreds of frames, so he built a
tool that picks the best ones the way he would: by what the image was trying
to capture rather than which is sharpest. Live app:
https://contact-sheet-three.vercel.app/

Key engineering decisions:

- Production-style web app in Next.js and TypeScript with Claude doing
  vision-based image scoring against user intent.
- An eval-fixtures harness and Playwright tests to measure scoring quality and
  catch regressions.
- Scoring logic that ranks images by what the photographer is selecting for,
  not generic aesthetics.
