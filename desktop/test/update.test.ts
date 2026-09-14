import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_GAP_MS, DEFAULT_UPDATE_ORIGIN, dueForCheck, installPercent, installSteps, newerVersion, readUpdateState, savedUpdate, updateFeedUrl, updateOrigin } from "../shared/update";

test("newerVersion takes only a higher semver and tolerates a v prefix", () => {
  assert.equal(newerVersion("0.1.0", "0.2.0"), "0.2.0");
  assert.equal(newerVersion("0.1.0", "v0.1.1"), "0.1.1");
  assert.equal(newerVersion("0.9.0", "1.0.0"), "1.0.0");
  assert.equal(newerVersion("0.10.0", "0.9.0"), "");
  assert.equal(newerVersion("0.1.0", "0.1.0"), "");
  assert.equal(newerVersion("0.1.0", "0.0.9"), "");
});

test("newerVersion refuses anything that is not a plain version", () => {
  assert.equal(newerVersion("0.1.0", ""), "");
  assert.equal(newerVersion("0.1.0", undefined), "");
  assert.equal(newerVersion("0.1.0", { version: "9.9.9" }), "");
  assert.equal(newerVersion("0.1.0", "0.2"), "");
  assert.equal(newerVersion("0.1.0", "Shinbo 0.2.0"), "");
  assert.equal(newerVersion("nightly", "0.2.0"), "");
});

test("installSteps re-downloads only when this process has not downloaded the update", () => {
  assert.deepEqual(installSteps("0.2.0", true), ["Saving your work", "Relaunching"]);
  assert.deepEqual(installSteps("0.2.0", false), ["Checking for updates", "Downloading 0.2.0", "Saving your work", "Relaunching"]);
});

test("installPercent counts finished steps and stays inside 0 to 100", () => {
  assert.equal(installPercent(0, 4), 0);
  assert.equal(installPercent(1, 4), 25);
  assert.equal(installPercent(3, 4), 75);
  assert.equal(installPercent(9, 4), 100);
  assert.equal(installPercent(-1, 4), 0);
  assert.equal(installPercent(1, 0), 0);
});

test("readUpdateState accepts only a well-formed state", () => {
  const state = { phase: "installing", version: "0.2.0", step: "Downloading 0.2.0", percent: 25, detail: "" };
  assert.deepEqual(readUpdateState(state), state);
  assert.equal(readUpdateState({ ...state, phase: "done" }), null);
  assert.equal(readUpdateState({ ...state, percent: 101 }), null);
  assert.equal(readUpdateState({ ...state, percent: Number.NaN }), null);
  assert.equal(readUpdateState({ ...state, step: 3 }), null);
  assert.equal(readUpdateState({ ...state, detail: "x".repeat(600) }), null);
  assert.equal(readUpdateState("ready"), null);
  assert.equal(readUpdateState(null), null);
});

test("updateOrigin keeps an https origin and loopback http, and discards the rest", () => {
  assert.equal(updateOrigin("https://update.electronjs.org/"), "https://update.electronjs.org");
  assert.equal(updateOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(updateOrigin("http://staging.example.com"), "");
  assert.equal(updateOrigin("https://update.example.com/feed"), "");
  assert.equal(updateOrigin("https://update.example.com?token=1"), "");
  assert.equal(updateOrigin(undefined), "");
  assert.equal(updateOrigin(`https://${"a".repeat(600)}.example.com`), "");
});

test("updateFeedUrl names the running build", () => {
  assert.equal(updateFeedUrl(DEFAULT_UPDATE_ORIGIN, "darwin", "arm64", "0.1.0"), "https://update.electronjs.org/tronschell/shinbo/darwin-arm64/0.1.0");
  assert.equal(updateFeedUrl(DEFAULT_UPDATE_ORIGIN, "win32", "x64", "0.1.0"), "https://update.electronjs.org/tronschell/shinbo/win32-x64/0.1.0");
});

test("dueForCheck throttles repeat checks", () => {
  assert.equal(dueForCheck(0, 0), true);
  assert.equal(dueForCheck(CHECK_GAP_MS * 10, 0), true);
  assert.equal(dueForCheck(CHECK_GAP_MS - 1, 1), false);
  assert.equal(dueForCheck(CHECK_GAP_MS + 1, 1), true);
});

test("savedUpdate restores only a newer version from a well-formed record", () => {
  assert.deepEqual(savedUpdate({ version: "0.4.1" }, "0.2.3"), { version: "0.4.1", install: false });
  assert.deepEqual(savedUpdate({ version: "v0.4.1", install: true }, "0.2.3"), { version: "0.4.1", install: true });
  assert.deepEqual(savedUpdate({ version: "0.2.3", install: true }, "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate({ version: "0.4.1", install: "yes" }, "0.2.3"), { version: "0.4.1", install: false });
  assert.deepEqual(savedUpdate({ version: "0.1.0" }, "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate({ version: 41 }, "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate({}, "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate(["0.4.1"], "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate(null, "0.2.3"), { version: "", install: false });
  assert.deepEqual(savedUpdate("0.4.1", "0.2.3"), { version: "", install: false });
});
