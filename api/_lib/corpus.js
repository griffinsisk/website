import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Candidate locations for the corpus dir: project-root-relative (how Vercel's
// includeFiles lays out bundled files from the repo root) and module-relative
// (fallback in case the bundle is laid out relative to the function file).
const CANDIDATE_DIRS = [
  path.join(process.cwd(), "api", "corpus"),
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus"),
];

const cache = new Map(); // dir (or "default") -> concatenated corpus string

async function readDirCorpus(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  // An empty dir must fail loudly (and let the next candidate try) — a corpus-less
  // agent would silently violate its grounding rules on every answer.
  if (files.length === 0) throw new Error(`no corpus .md files found in ${dir}`);
  const parts = await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8")));
  return parts.join("\n\n");
}

// Reads every .md file in the corpus dir, sorted by filename (number prefixes
// control order), joined into one prompt block. Cached for the lifetime of the
// serverless instance — the corpus only changes on deploy.
export async function loadCorpus(dir) {
  const key = dir ?? "default";
  if (cache.has(key)) return cache.get(key);
  let corpus;
  if (dir) {
    corpus = await readDirCorpus(dir);
  } else {
    let lastErr;
    for (const candidate of CANDIDATE_DIRS) {
      try {
        corpus = await readDirCorpus(candidate);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (corpus === undefined) throw lastErr;
  }
  cache.set(key, corpus);
  return corpus;
}
