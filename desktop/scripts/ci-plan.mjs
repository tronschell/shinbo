import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export function planChecks(files, { promotion = false, manual = false, packageRequested = false, versionOnly = false } = {}) {
  const plan = { desktop: false, rust: false, harness: false, package: promotion || packageRequested };
  if (promotion || manual) return { ...plan, desktop: true, rust: true, harness: true };
  for (const file of files) {
    if (file === "package.json" && versionOnly) continue;
    if (/^(docs\/|\.claude\/skills\/|\.agents\/skills\/)|^[^/]+\.md$/.test(file)) continue;
    if (/^desktop\/(src\/|assets\/|index\.html$)/.test(file)) {
      plan.desktop = true;
      continue;
    }
    plan.desktop = plan.rust = plan.harness = true;
    if (/^(\.github\/|desktop\/scripts\/|desktop\/native\/)|^(package\.json|desktop\/package(?:-lock)?\.json)$/.test(file)) plan.package = true;
  }
  return plan;
}

export function validatePromotion(event, baseVersion, version, mergedTree, headTree) {
  const pr = event.pull_request;
  assert.equal(pr.head.repo?.full_name, event.repository.full_name, "Promote this repository's dev branch.");
  assert.equal(pr.head.ref, "dev", "Open the release PR directly from dev to main.");
  assert.equal(mergedTree, headTree, "The promotion must contain exactly dev's tree; resolve main-only changes on dev first.");
  assert.match(baseVersion, /^\d+\.\d+\.\d+$/);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const before = baseVersion.split(".").map(BigInt);
  const after = version.split(".").map(BigInt);
  const difference = after.findIndex((part, index) => part !== before[index]);
  assert.ok(difference >= 0 && after[difference] > before[difference], "Bump the root package.json version on dev before promoting.");
}

export async function releaseExists(repository, version, request = fetch) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const response = await request(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return false;
  assert.equal(response.status, 200, `Could not check release v${version}: HTTP ${response.status}`);
  return true;
}

if (import.meta.main) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  let plan;
  if (process.env.GITHUB_EVENT_NAME === "push") {
    assert.equal(process.env.GITHUB_REF, "refs/heads/main");
    plan = { desktop: false, rust: false, harness: false, package: !await releaseExists(event.repository.full_name, version) };
  } else if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    plan = planChecks([], { manual: true, packageRequested: event.inputs?.package === "true" });
  } else {
    assert.equal(process.env.GITHUB_EVENT_NAME, "pull_request");
    const pr = event.pull_request;
    assert.ok(["dev", "main"].includes(pr.base.ref));
    const base = pr.base.sha;
    const head = process.env.GITHUB_SHA;
    assert.match(base, /^[a-f0-9]{40}$/);
    assert.match(head, /^[a-f0-9]{40}$/);
    const files = git("diff", "--name-only", "--no-renames", "-z", base, head).split("\0").filter(Boolean);
    const before = JSON.parse(git("show", `${base}:package.json`));
    const after = JSON.parse(readFileSync("package.json", "utf8"));
    const versionOnly = isDeepStrictEqual({ ...before, version: null }, { ...after, version: null });
    if (pr.base.ref === "main") {
      assert.match(pr.head.sha, /^[a-f0-9]{40}$/);
      validatePromotion(event, before.version, version, git("rev-parse", `${head}^{tree}`), git("rev-parse", `${pr.head.sha}^{tree}`));
    }
    plan = planChecks(files, { promotion: pr.base.ref === "main", versionOnly });
  }
  const outputs = Object.entries(plan).map(([name, value]) => `${name}=${value}`).join("\n");
  console.log(outputs);
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputs}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| Check | Required |\n| --- | --- |\n${Object.entries(plan).map(([name, value]) => `| ${name} | ${value} |`).join("\n")}\n`);
}
