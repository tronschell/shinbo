import assert from "node:assert/strict";
import test from "node:test";
import { retiredDefaults } from "../shared/legacy-defaults";
import { DEFAULT_SYSTEM_PROMPT } from "../shared/prompts";
import { comboKeybind, defaultSettings, defaultTaggerSystem, defaultVerifierSystem, MAX_VERIFIER_SYSTEM_CHARS, repairSettings, validateSettings } from "../shared/settings";

const provider = (id: string, baseUrl: string) => ({ id, name: id, modelId: "qwen3-8b", baseUrl, credentialEnv: "", contextWindow: 0, insecure: false });

test("repairSettings keeps every valid slice when one slice or one entry is invalid", () => {
  const stored = {
    ...validateSettings(defaultSettings),
    systemPrompt: "Custom prompt",
    notchModel: "codex:gpt-5",
    providers: [provider("good", "http://127.0.0.1:1234/v1"), provider("bad", "http://192.168.1.20:1234/v1")],
    keybinds: { voice: comboKeybind("Command+Alt+V"), draw: comboKeybind("Command+Q") },
    verifier: { ...defaultSettings.verifier, model: "custom/model", system: "x".repeat(MAX_VERIFIER_SYSTEM_CHARS + 1) },
    uiScale: "huge",
  };
  assert.throws(() => validateSettings(stored));
  const repaired = repairSettings(stored);
  assert.equal(repaired.systemPrompt, "Custom prompt");
  assert.equal(repaired.notchModel, "");
  assert.deepEqual(repaired.providers.map((item) => item.id), ["good"]);
  assert.deepEqual(Object.keys(repaired.keybinds), ["voice"]);
  assert.equal(repaired.verifier.model, "custom/model");
  assert.equal(repaired.verifier.system, defaultVerifierSystem);
  assert.equal(repaired.uiScale, defaultSettings.uiScale);
  assert.deepEqual(repairSettings(validateSettings(defaultSettings)), validateSettings(defaultSettings));
  assert.deepEqual(repairSettings("garbage"), validateSettings(defaultSettings));
});

test("validateSettings swaps a retired default prompt or rule set for the current one", () => {
  assert.ok(retiredDefaults.length >= 9);
  assert.ok(retiredDefaults.every((text) => text !== DEFAULT_SYSTEM_PROMPT && text !== defaultVerifierSystem && text !== defaultTaggerSystem));
  const emma = retiredDefaults.find((text) => text.startsWith("# Emma"));
  assert.ok(emma);
  const stored = { ...defaultSettings, systemPrompt: emma, verifier: { ...defaultSettings.verifier, system: retiredDefaults.find((text) => text.startsWith("You review one action")) }, tagger: { ...defaultSettings.tagger, system: "My own tagging rules" } };
  const valid = validateSettings(stored);
  assert.equal(valid.systemPrompt, DEFAULT_SYSTEM_PROMPT);
  assert.equal(valid.verifier.system, defaultVerifierSystem);
  assert.equal(valid.tagger.system, "My own tagging rules");
  assert.equal(validateSettings({ ...defaultSettings, systemPrompt: `${emma}\nExtra rule` }).systemPrompt, `${emma}\nExtra rule`);
});
