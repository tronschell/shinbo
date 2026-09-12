import assert from "node:assert/strict";
import test from "node:test";
import { planChecks, releaseExists, validatePromotion } from "../scripts/ci-plan.mjs";

test("renderer changes keep desktop coverage without the harness and Rust suites", () => {
  assert.deepEqual(planChecks(["desktop/src/App.tsx", "desktop/src/styles/sidebar.css", "desktop/assets/logo.png"]), { desktop: true, rust: false, harness: false, package: false });
});

test("documentation and a version-only bump need no compilation", () => {
  assert.deepEqual(planChecks(["docs/releases.md", "AGENTS.md", ".claude/skills/releasing/SKILL.md", "package.json"], { versionOnly: true }), { desktop: false, rust: false, harness: false, package: false });
});

test("trust boundaries, harness code, deletions and unknown files retain all checks", () => {
  for (const file of ["harness/src/main.zig", "crates/core/src/lib.rs", "desktop/main/harness.ts", "desktop/shared/bridge.ts", "desktop/test/harness.test.ts", "desktop/skills/building-shinbo/SKILL.md", "new-build-config", "desktop/src-old/removed.ts"]) {
    const plan = planChecks([file]);
    assert.ok(plan.desktop && plan.rust && plan.harness, file);
  }
});

test("build and workflow changes exercise packaging before promotion", () => {
  for (const file of [".github/workflows/ci.yml", "desktop/scripts/package-windows.mjs", "desktop/native/computer_win.cpp", "package.json", "desktop/package-lock.json", "Cargo.lock", "rust-toolchain.toml", "harness/build.zig.zon", "crates/host/Cargo.toml"]) assert.equal(planChecks([file]).package, true, file);
});

test("promotion and manual runs retain full checks even with no changed paths", () => {
  assert.deepEqual(planChecks([], { promotion: true }), { desktop: true, rust: true, harness: true, package: true });
  assert.deepEqual(planChecks([], { manual: true }), { desktop: true, rust: true, harness: true, package: false });
  assert.equal(planChecks([], { manual: true, packageRequested: true }).package, true);
});

test("promotion requires the same repository's dev tree and a newer stable version", () => {
  const event = { repository: { full_name: "owner/shinbo" }, pull_request: { head: { ref: "dev", repo: { full_name: "owner/shinbo" } } } };
  validatePromotion(event, "0.6.9", "0.6.10", "tree", "tree");
  validatePromotion(event, "0.6.9", "1.0.0", "tree", "tree");
  for (const version of ["0.6.9", "0.6.8", "0.5.10", "0.7.0-beta"]) assert.throws(() => validatePromotion(event, "0.6.9", version, "tree", "tree"));
  assert.throws(() => validatePromotion(event, "0.6.9", "0.7.0", "merged", "dev"));
  assert.throws(() => validatePromotion({ ...event, pull_request: { head: { ...event.pull_request.head, ref: "release/temporary" } } }, "0.6.9", "0.7.0", "tree", "tree"));
  assert.throws(() => validatePromotion({ ...event, pull_request: { head: { ref: "dev", repo: { full_name: "fork/shinbo" } } } }, "0.6.9", "0.7.0", "tree", "tree"));
});

test("published versions skip builds while release lookup failures stop CI", async () => {
  assert.equal(await releaseExists("owner/shinbo", "0.6.0", async () => ({ status: 200 })), true);
  assert.equal(await releaseExists("owner/shinbo", "0.6.0", async () => ({ status: 404 })), false);
  for (const status of [401, 403, 429, 500]) await assert.rejects(releaseExists("owner/shinbo", "0.6.0", async () => ({ status })));
  await assert.rejects(releaseExists("owner/shinbo", "0.6.0", async () => { throw new Error("network failure"); }));
});
