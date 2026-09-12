import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AttachmentStore } from "../main/attachments";

const userData = () => mkdtempSync(path.join(tmpdir(), "shinbo-attachments-"));

test("a picked text file comes back whole, and only what was attached is readable", () => {
  const root = userData();
  const file = path.join(root, "rows.csv");
  writeFileSync(file, "name,count\nzig,2\n");
  const store = new AttachmentStore(root);
  const held = store.hold(file);
  assert.equal(store.read(held.id).text, "name,count\nzig,2\n");


  assert.equal(store.holds(held.path), true);
  assert.equal(store.holds(path.join(root, "elsewhere.csv")), false);
  assert.throws(() => store.read("not-an-attachment"));
});

test("a dropped file is written under userData and named by its own basename", () => {
  const root = userData();
  const store = new AttachmentStore(root);
  const held = store.save("../../escape.md", new TextEncoder().encode("# notes"));
  assert.equal(held.name, "escape.md");
  assert.equal(path.dirname(held.path), path.join(root, "attachments"));
  assert.deepEqual(readdirSync(path.join(root, "attachments")).filter((entry) => entry !== "held.json"), [`${held.id}-escape.md`]);
  assert.equal(store.read(held.id).text, "# notes");
});

test("a picture carries its path instead of its bytes, and a binary file is refused", () => {
  const root = userData();
  const store = new AttachmentStore(root);
  const image = store.save("shot.png", new Uint8Array([137, 80, 78, 71, 0, 13]));
  assert.equal(store.read(image.id).text, undefined);
  assert.equal(store.read(image.id).path, image.path);
  const binary = store.save("blob.bin", new Uint8Array([1, 0, 2]));
  assert.throws(() => store.read(binary.id), /not a text file/);
});

test("what was attached is still attached after a relaunch, unless the file is gone", () => {
  const root = userData();
  const moved = path.join(root, "moved.md");
  writeFileSync(moved, "# here for now");
  const first = new AttachmentStore(root);
  const dropped = first.save("notes.md", new TextEncoder().encode("# notes"));
  const picked = first.hold(moved);



  const relaunched = new AttachmentStore(root);
  assert.equal(relaunched.holds(dropped.path), true);
  assert.equal(relaunched.holds(picked.path), true);
  assert.equal(relaunched.read(dropped.id).text, "# notes");

  rmSync(moved);
  assert.equal(new AttachmentStore(root).holds(picked.path), false);
});

test("new uploads preserve held attachments older than seven days", () => {
  const root = userData();
  const store = new AttachmentStore(root);
  const first = store.save("old.md", new TextEncoder().encode("permanent conversation context"));
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(first.path, old, old);
  store.save("new.md", new TextEncoder().encode("another conversation"));
  assert.equal(store.read(first.id).text, "permanent conversation context");
  assert.equal(new AttachmentStore(root).read(first.id).text, "permanent conversation context");
});

for (const operation of ["save", "hold"] as const) {
  test(`a failed attachment index write rejects ${operation} and preserves already saved attachments`, (t) => {
    const root = userData();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const store = new AttachmentStore(root);
    const original = store.save("original.md", Buffer.from("previous user work"));
    const index = path.join(root, "attachments", "held.json");
    const before = fs.readFileSync(index);
    const picked = path.join(root, "picked.md");
    writeFileSync(picked, "new user work");
    const write = fs.writeFileSync;
    const failure = t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof write>) => {
      if (String(args[0]).includes("held.json") && String(args[0]).endsWith(".tmp")) throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      return write(...args);
    });
    assert.throws(() => operation === "save" ? store.save("next.md", Buffer.from("new user work")) : store.hold(picked), /no space left/);
    assert.deepEqual(fs.readFileSync(index), before);
    assert.equal(store.holds(picked), false);
    assert.equal(new AttachmentStore(root).read(original.id).text, "previous user work");
    assert.deepEqual(readdirSync(path.dirname(index)).sort(), [path.basename(original.path), "held.json"].sort());
    failure.mock.restore();
    const retried = operation === "save" ? store.save("next.md", Buffer.from("new user work")) : store.hold(picked);
    assert.equal(new AttachmentStore(root).read(retried.id).text, "new user work");
  });
}
