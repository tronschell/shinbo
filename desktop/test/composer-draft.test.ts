import test from "node:test";
import assert from "node:assert/strict";
import { setThreadDraft, threadDraft } from "../src/context";


const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

test("an unsent prompt and its attachments come back to the thread that held them", () => {
  store.clear();
  const picks = [{ kind: "attachment" as const, id: "a1", name: "shot.png", path: "/tmp/shot.png" }];
  setThreadDraft("t1", { text: "half a thought", picks });
  assert.deepEqual(threadDraft("t1"), { text: "half a thought", picks });
  assert.deepEqual(threadDraft("t2"), { text: "", picks: [] });
});

test("sending clears the draft, and junk in storage reads as empty", () => {
  store.clear();
  setThreadDraft("t1", { text: "sent now", picks: [] });
  setThreadDraft("t1", { text: "", picks: [] });
  assert.deepEqual(threadDraft("t1"), { text: "", picks: [] });
  store.set("shinbo.threadDraft.v1.t3", "{oops");
  assert.deepEqual(threadDraft("t3"), { text: "", picks: [] });
  store.set("shinbo.threadDraft.v1.t4", JSON.stringify({ text: 7, picks: [{ kind: "nope" }, null] }));
  assert.deepEqual(threadDraft("t4"), { text: "", picks: [] });
});

test("storage quota preserves other drafts and keeps the unsaved draft available until a successful retry", (t) => {
  const prefix = "shinbo.threadDraft.v1.";
  const first = { text: "important unsent first task", picks: [] };
  const second = { text: "new task draft", picks: [] };
  let full = false;
  const values: Record<string, string> = {};
  const storage = Object.assign(values, {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      values[key] = value;
    },
    removeItem: (key: string) => { delete values[key]; },
  });
  t.mock.property(globalThis, "localStorage", storage as unknown as Storage);
  setThreadDraft("quota-first", first);
  full = true;
  const saved = setThreadDraft("quota-second", second);
  assert.equal(values[prefix + "quota-first"], JSON.stringify(first));
  assert.equal(saved, false);
  assert.deepEqual(threadDraft("quota-second"), second);
  assert.deepEqual(threadDraft("quota-first"), first);
  full = false;
  assert.equal(setThreadDraft("quota-second", second), true);
  assert.equal(values[prefix + "quota-second"], JSON.stringify(second));
  assert.equal(setThreadDraft("quota-second", { text: "", picks: [] }), true);
  assert.deepEqual(threadDraft("quota-second"), { text: "", picks: [] });
});
