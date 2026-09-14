import test from "node:test";
import assert from "node:assert/strict";
import { rememberTurnAttachments, turnAttachments } from "../src/context";
import type { Message } from "../src/types";




const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

const said = (content: string): Message => ({ role: "user", content, timestamp: "2026-08-23T10:00:00.000Z" });
const replied = (): Message => ({ role: "assistant", content: "…", timestamp: "2026-08-23T10:01:00.000Z" });
const shot = (name: string) => [{ name, path: `/tmp/${name}` }];

test("a turn's files land on the message that turn wrote", () => {
  store.clear();
  rememberTurnAttachments("t1", 0, "what is this", shot("one.png"));
  rememberTurnAttachments("t1", 2, "and this", shot("two.png"));
  const messages = [said("what is this"), replied(), said("and this"), replied()];
  assert.deepEqual(turnAttachments("t1", messages), { 0: shot("one.png"), 2: shot("two.png") });
});

test("the same prompt sent twice keeps its two sets apart", () => {
  store.clear();
  rememberTurnAttachments("t2", 0, "look", shot("first.png"));
  rememberTurnAttachments("t2", 2, "look", shot("second.png"));
  assert.deepEqual(turnAttachments("t2", [said("look"), replied(), said("look"), replied()]), {
    0: shot("first.png"),
    2: shot("second.png"),
  });
});

test("a turn whose message never landed shows nothing, and shifted messages still match", () => {
  store.clear();
  rememberTurnAttachments("t3", 0, "never sent", shot("lost.png"));
  assert.deepEqual(turnAttachments("t3", [said("something else"), replied()]), {});


  rememberTurnAttachments("t3", 0, "mine", shot("mine.png"));
  assert.deepEqual(turnAttachments("t3", [said("from the notch"), replied(), said("mine"), replied()]), { 2: shot("mine.png") });
});

test("a half-written or hand-edited entry is a miss, not a crash", () => {
  store.clear();
  store.set("shinbo.threadAttachments.v1.t4", '[{"after":0,"content":"hi"},{"nope":true},7]');
  assert.deepEqual(turnAttachments("t4", [said("hi")]), {});
  store.set("shinbo.threadAttachments.v1.t4", "not json at all");
  assert.deepEqual(turnAttachments("t4", [said("hi")]), {});
});
