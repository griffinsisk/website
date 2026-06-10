import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus } from "../api/_lib/corpus.js";

async function makeCorpusDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-"));
  await writeFile(path.join(dir, "10-second.md"), "## Second\nbeta");
  await writeFile(path.join(dir, "00-first.md"), "## First\nalpha");
  await writeFile(path.join(dir, "ignore.txt"), "not markdown");
  return dir;
}

test("concatenates only .md files in filename order", async () => {
  const dir = await makeCorpusDir();
  const corpus = await loadCorpus(dir);
  assert.ok(corpus.indexOf("## First") < corpus.indexOf("## Second"), "00- file should come first");
  assert.ok(!corpus.includes("not markdown"), "non-md files are excluded");
});

test("caches per directory", async () => {
  const dir = await makeCorpusDir();
  const first = await loadCorpus(dir);
  await writeFile(path.join(dir, "99-later.md"), "## Later\nadded after first load");
  const second = await loadCorpus(dir);
  assert.equal(second, first, "second load should be served from cache");
});

test("loads the real corpus directory by default", async () => {
  const corpus = await loadCorpus();
  assert.ok(corpus.includes("## About"), "real corpus should contain the About section");
});
