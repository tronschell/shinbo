import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactRoot, listArtifacts, queryArtifact, readArtifact, updateArtifact, writeArtifact, writeArtifactFile } from "../main/artifacts";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "shinbo-artifact-durability-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("simultaneous artifact creations preserve both outputs", () => fixture(async (directory) => {
  const made = await Promise.all(["first", "second"].map((content) => writeArtifact(directory, { title: "Results", kind: "markdown", content })));
  assert.equal(new Set(made.map((item) => item.id)).size, 2);
  const stored = await listArtifacts(directory);
  assert.equal(stored.length, 2);
  assert.deepEqual((await Promise.all(stored.map((item) => readArtifact(directory, item.id)))).map((item) => item.content).sort(), ["first", "second"]);
}));

test("simultaneous disjoint artifact edits both survive", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "notes", title: "Notes", kind: "markdown", content: "one two" });
  await Promise.all([updateArtifact(directory, "notes", "one", "ONE"), updateArtifact(directory, "notes", "two", "TWO")]);
  const stored = await readArtifact(directory, "notes");
  assert.equal(stored.content, "ONE TWO");
  assert.equal(stored.version, 3);
}));

test("writing a side file cannot restore a stale app entry", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "old entry" });
  await Promise.all([
    writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "new entry" }),
    writeArtifactFile(directory, "app", "app.js", "new script"),
  ]);
  const stored = await readArtifact(directory, "app");
  assert.equal(stored.content, "new entry");
  assert.equal(stored.version, 3);
}));

test("a rejected kind conversion preserves the original artifact", () => fixture(async (directory) => {
  const original = await writeArtifact(directory, { id: "notes", title: "Notes", kind: "markdown", content: "irreplaceable notes" });
  await mkdir(path.join(artifactRoot(directory), "notes", "content.html"));
  await assert.rejects(writeArtifact(directory, { id: "notes", title: "Notes", kind: "html", content: "converted" }), /EISDIR|EPERM/);
  assert.deepEqual(await readArtifact(directory, "notes"), original);
  await updateArtifact(directory, "notes", "notes", "text");
  assert.equal((await readArtifact(directory, "notes")).content, "irreplaceable text");
}));

test("an unbounded SQL computation times out while the main event loop stays responsive", (t) => fixture(async (directory) => {
  const fork = childProcess.fork;
  const exits: Promise<unknown>[] = [];
  t.mock.method(childProcess, "fork", (...args: Parameters<typeof fork>) => {
    const child = fork(...args);
    exits.push(once(child, "exit"));
    return child;
  });
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "<html></html>" });
  let heartbeats = 0;
  const interval = setInterval(() => { heartbeats += 1; }, 50);
  const began = performance.now();
  try {
    await assert.rejects(queryArtifact(directory, "app", "WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r) SELECT count(*) FROM r", []), /time limit/);
    assert.ok(heartbeats >= 10, `${heartbeats} heartbeats`);
    assert.ok(performance.now() - began < 4000);
    assert.deepEqual(await queryArtifact(directory, "app", "select 1 as ok", []), [{ ok: 1 }]);
    await Promise.all(exits);
  } finally { clearInterval(interval); }
}));

test("artifact queries cannot disable resource limits or return unbounded blobs", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "<html></html>" });
  await assert.rejects(queryArtifact(directory, "app", "pragma hard_heap_limit = 0", []), /not authorized/);
  await assert.rejects(queryArtifact(directory, "app", "pragma max_page_count = 2147483646", []), /not authorized/);
  await assert.rejects(queryArtifact(directory, "app", "select zeroblob(5000000) as data", []), /too much data/);
}));

test("artifact queries past the concurrency cap wait their turn instead of failing", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "<html></html>" });
  const rows = await Promise.all(Array.from({ length: 8 }, (_, at) => queryArtifact(directory, "app", "select ? as at", [at])));
  assert.deepEqual(rows.map(([row]) => row.at), [0, 1, 2, 3, 4, 5, 6, 7]);
}));


test("changing between artifact kinds with the same extension retains the new content", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "old entry" });
  await writeArtifact(directory, { id: "app", title: "App", kind: "html", content: "new entry" });
  assert.equal((await readArtifact(directory, "app")).content, "new entry");
}));

test("a timed out SQL write rolls back and releases the database", () => fixture(async (directory) => {
  await writeArtifact(directory, { id: "app", title: "App", kind: "app", content: "<html></html>" });
  await queryArtifact(directory, "app", "create table notes (body text)", []);
  await queryArtifact(directory, "app", "insert into notes values ('original'), ('pending')", []);
  await queryArtifact(directory, "app", "pragma foreign_keys = on", []);
  await assert.rejects(queryArtifact(directory, "app", "UPDATE notes SET body = CASE WHEN body = 'original' THEN 'updated' ELSE (WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r) SELECT count(*) FROM r) END", []), /time limit/);
  assert.deepEqual(await queryArtifact(directory, "app", "select body from notes", []), [{ body: "original" }, { body: "pending" }]);
  assert.deepEqual(await queryArtifact(directory, "app", "pragma integrity_check", []), [{ integrity_check: "ok" }]);
  await queryArtifact(directory, "app", "insert into notes values ('after timeout')", []);
  assert.deepEqual(await queryArtifact(directory, "app", "select count(*) as total from notes", []), [{ total: 3 }]);
}));
