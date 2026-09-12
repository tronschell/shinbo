import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, validateSettings } from "../shared/settings";

test("tab color defaults to white, persists custom colors, and rejects invalid values", () => {
  assert.equal(validateSettings({ ...defaultSettings, tabColor: undefined }).tabColor, "#ffffff");
  assert.equal(validateSettings({ ...defaultSettings, tabColor: "#123456" }).tabColor, "#123456");
  assert.throws(() => validateSettings({ ...defaultSettings, tabColor: "invalid" }), /Appearance settings/);
});
