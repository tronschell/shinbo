import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const modules = process.argv.slice(2);
if (modules.length !== 2) throw new Error("Pass baseline and fixed compiled vault.js paths.");
const readers = modules.map((file) => require(path.resolve(file)).listNotes);
const root = mkdtempSync(path.join(tmpdir(), "shinbo-notes-perf-"));
const folder = path.join(root, "notes");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const results = [[], []];
try {
  mkdirSync(folder);
  const body = "A supported saved note with plain text and markdown.\n".repeat(630);
  let bytes = 0;
  for (let index = 0; index < 1000; index++) {
    const text = `---\ntitle: "Note ${index}"\nkind: "note"\nsaved: "2026-09-12T00:00:00.000Z"\ntags: []\n---\n${body}`;
    bytes += Buffer.byteLength(text);
    writeFileSync(path.join(folder, `note-${index}.md`), text);
  }
  let expected;
  for (let pass = 0; pass < 5; pass++) {
    for (const mode of pass % 2 ? [1, 0] : [0, 1]) {
      let last = performance.now(), maxGap = 0, ticks = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
      }, 1);
      try {
        await pause(5);
        maxGap = 0;
        ticks = 0;
        const start = performance.now();
        const notes = await readers[mode]({ root, folder: "notes", kind: "folder", name: "Fixture" });
        const elapsed = performance.now() - start;
        const during = ticks;
        await pause(5);
        clearInterval(heartbeat);
        if (expected) assert.deepEqual(notes, expected);
        else expected = notes;
        const measured = { pass, mode: mode ? "fixed" : "baseline", elapsed, maxGap, during, notes: notes.length };
        results[mode].push(measured);
        console.log(JSON.stringify(measured));
      } finally { clearInterval(heartbeat); }
    }
  }
  console.log(JSON.stringify({ bytes, identical: true, medians: results.map((runs, index) => ({
    mode: index ? "fixed" : "baseline", elapsed: median(runs.map((run) => run.elapsed)),
    maxGap: median(runs.map((run) => run.maxGap)), during: median(runs.map((run) => run.during)),
  })) }));
} finally { rmSync(root, { recursive: true, force: true }); }
