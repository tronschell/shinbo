import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { harnessMcpServers, ImportedCapabilityRuntime, listShinboTools, loadImportedSkill, MAX_SKILL_RESULTS, mirrorSkillsToHarness, parseMcpConfig, previewImportedSkill, seedBuiltinSkills, SkillAttachmentStore, writeShinboTool } from "../main/capabilities";
import { shellQuoted } from "../main/tools";
import { isWindows } from "../main/platform";

test("bundled skills are seeded into both skill roots and are searchable without an import", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-builtin-"));
  try {
    const builtin = path.join(root, "bundle");
    const userData = path.join(root, "user-data");
    const harnessHome = path.join(userData, "harness");
    await mkdir(path.join(builtin, "building-shinbo"), { recursive: true });
    await mkdir(path.join(builtin, "not-a-skill"), { recursive: true });
    await writeFile(path.join(builtin, "building-shinbo", "SKILL.md"), "---\nname: building-shinbo\n---\nRebuild, then verify.");

    assert.deepEqual(await seedBuiltinSkills(builtin, userData, harnessHome), ["building-shinbo"]);
    assert.equal(await readFile(path.join(harnessHome, ".fx", "skills", "building-shinbo", "SKILL.md"), "utf8"), "---\nname: building-shinbo\n---\nRebuild, then verify.");

    const runtime = new ImportedCapabilityRuntime(userData);
    const [found] = await runtime.searchSkills("build");
    assert.deepEqual(found, { id: "skill:shinbo:0:building-shinbo", source: "shinbo", name: "building-shinbo" });
    assert.ok(await runtime.searchSkills("", MAX_SKILL_RESULTS));
    assert.match((await runtime.selectSkill(found.id)).instructions, /Rebuild, then verify\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skill attachments are one-turn, retryable, and bound to their thread", () => {
  const store = new SkillAttachmentStore();
  const skill = { id: "skill:codex:0:review", source: "codex", name: "review", instructions: "Review carefully." };
  store.put(skill, "thread-123456789012");
  assert.equal(store.status()?.threadId, "thread-123456789012");
  assert.throws(() => store.claim(skill.id, "thread-000000000000"), /unavailable/);
  assert.equal(store.claim(skill.id, "thread-123456789012").instructions, skill.instructions);
  store.finish(skill.id, false);
  assert.equal(store.claim(skill.id, "thread-123456789012").name, "review");
  store.finish(skill.id, true);
  assert.equal(store.status(), null);
});

test("imported skills stay metadata-only until selected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-capabilities-"));
  try {
    const skillRoot = path.join(root, "skills");
    const userData = path.join(root, "user-data");
    await mkdir(path.join(skillRoot, "review"), { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(skillRoot, "review", "SKILL.md"), "secret skill instructions");
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "codex", skillRoots: [skillRoot], mcpFiles: [] }] }));

    const runtime = new ImportedCapabilityRuntime(userData);
    const results = await runtime.searchSkills("review");
    assert.deepEqual(results, [{ id: "skill:codex:0:review", source: "codex", name: "review" }]);
    assert.equal(JSON.stringify(results).includes("secret"), false);
    assert.deepEqual(await runtime.selectSkill(results[0].id), { id: results[0].id, source: "codex", name: "review", instructions: "secret skill instructions" });
    assert.deepEqual(await runtime.previewSkill("review"), { path: path.join(await realpath(skillRoot), "review", "SKILL.md"), text: "secret skill instructions" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a tool Shinbo writes is executable, listed with its description, and replaced by name", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-tools-"));
  try {
    const written = await writeShinboTool(root, "count-lines", "Counts the lines of the file named in its input.", "#!/bin/sh\nwc -l < \"$1\"\n");
    assert.deepEqual(await listShinboTools(root), [written]);

    const fixed = await writeShinboTool(root, "count-lines", "Counts lines, words and bytes.", "#!/bin/sh\nwc \"$1\"\n");
    assert.equal((await listShinboTools(root)).length, 1);
    assert.equal((await listShinboTools(root))[0].description, fixed.description);

    await assert.rejects(() => writeShinboTool(root, "count-lines", "No interpreter.", "wc -l < \"$1\"\n"), /#!/);
    await assert.rejects(() => writeShinboTool(root, "../escape", "Outside the folder.", "#!/bin/sh\n:\n"), /invalid/);
    assert.deepEqual(await listShinboTools(path.join(root, "nothing-here")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a written tool runs under bash with its input as one argument", { skip: isWindows && "main launches written tools through their shebang interpreter on Windows" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-tools-run-"));
  try {
    const written = await writeShinboTool(root, "count-lines", "Counts the lines of the file named in its input.", "#!/bin/sh\nwc -l < \"$1\"\n");
    const sample = path.join(root, "it's a sample.txt");
    await writeFile(sample, "a\nb\nc\n");
    const { stdout } = await promisify(execFile)("/bin/bash", ["-lc", `${shellQuoted(written.run)} ${shellQuoted(sample)}`], { cwd: root });
    assert.equal(stdout.trim(), "3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an imported stdio server is listed with its arguments redacted and its environment values withheld", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-mcp-"));
  try {
    const userData = path.join(root, "user-data");
    const config = path.join(root, "claude.json");
    await mkdir(userData, { recursive: true });
    await writeFile(config, JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ["-e", "process.exit(0)"], env: { MCP_SECRET: "do-not-render" } } } }));
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "claude", skillRoots: [], mcpFiles: [config] }] }));

    const servers = await new ImportedCapabilityRuntime(userData).listMcpServers();
    assert.equal(servers.length, 1);
    assert.equal(servers[0].command, process.execPath);
    assert.deepEqual(servers[0].args, ["-e", "[argument 2 redacted]"]);
    assert.deepEqual(servers[0].environmentKeys, ["MCP_SECRET"]);
    assert.equal(JSON.stringify(servers).includes("do-not-render"), false);
    assert.deepEqual((await harnessMcpServers(userData)).map((server) => server.name), ["fixture"]);
    assert.deepEqual(await harnessMcpServers(userData, [servers[0].id]), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a remote server is kept only over https and reaches the harness with its headers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-remote-mcp-"));
  try {
    const userData = path.join(root, "user-data");
    const config = path.join(root, "cursor.json");
    await mkdir(userData, { recursive: true });
    await writeFile(config, JSON.stringify({ mcpServers: {
      remote: { type: "http", url: "https://mcp.example.com/s/do-not-render/v1", headers: { Authorization: "Bearer do-not-render", "Content-Type": "application/json" } },
      plain: { type: "http", url: "http://mcp.example.com/v1", headers: {} },
      userinfo: { type: "http", url: "https://user:do-not-render@mcp.example.com/v1", headers: {} },
      fragment: { type: "http", url: "https://mcp.example.com/v1#one", headers: {} },
      shouting: { type: "http", url: "https://mcp.example.com/v1", headers: { Authorization: "one", authorization: "two" } },
      local: { type: "stdio", command: process.execPath, url: "https://docs.example.com/local", args: [], env: {} },
    } }));
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "cursor", skillRoots: [], mcpFiles: [config] }] }));



    assert.deepEqual(parseMcpConfig(await readFile(config, "utf8"), "cursor.json").map((server) => server.name), ["remote", "local"]);

    assert.deepEqual(parseMcpConfig(JSON.stringify({ docs: { url: "https://example.com/one" } }), "cursor.json"), []);

    const listed = await new ImportedCapabilityRuntime(userData).listMcpServers();
    assert.deepEqual(listed.map((server) => [server.name, server.type, server.url]), [["remote", "http", "https://mcp.example.com"], ["local", undefined, undefined]]);


    assert.equal(JSON.stringify(listed).includes("do-not-render"), false);

    const forHarness = await harnessMcpServers(userData);
    assert.deepEqual(forHarness[0], {
      name: "remote",
      type: "http",
      url: "https://mcp.example.com/s/do-not-render/v1",
      headers: [{ name: "Authorization", value: "Bearer do-not-render" }],
    });
    assert.deepEqual({ ...forHarness[1], env: undefined }, { name: "local", command: process.execPath, args: [], env: undefined });
    assert.equal(forHarness[1].env?.[0]?.name, "PATH");
    assert.notEqual(forHarness[1].env?.[0]?.value, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an installed MCP server is listed with no import and no relaunch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-install-mcp-"));
  const userData = path.join(root, "user-data");
  const runtime = new ImportedCapabilityRuntime(userData);
  try {
    const definition = { name: "fixture", command: process.execPath, args: ["-e", "process.exit(0)"], env: { WHO: "installed" } };

    assert.deepEqual(await runtime.installMcpServer(definition), { id: "mcp:shinbo:0:fixture" });

    const listed = await new ImportedCapabilityRuntime(userData).listMcpServers();
    assert.deepEqual(listed.map((server) => server.id), ["mcp:shinbo:0:fixture"]);
    assert.deepEqual(listed[0].environmentKeys, ["WHO"]);
    assert.equal(JSON.stringify(listed).includes("installed"), false);

    await runtime.installMcpServer(definition);
    assert.equal((await runtime.listMcpServers()).length, 1);
    await assert.rejects(() => runtime.installMcpServer({ ...definition, name: "not a name" }), /not valid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a command that is not on the login-shell PATH is refused at install instead of dropped at launch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-install-mcp-path-"));
  try {
    const runtime = new ImportedCapabilityRuntime(path.join(root, "user-data"));
    await assert.rejects(() => runtime.installMcpServer({ name: "fixture", command: "shinbo-no-such-command", args: [], env: {} }), /not on the login-shell PATH/);
    assert.deepEqual(await runtime.listMcpServers(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two sources naming the same MCP server keep the first one for Settings and the harness alike", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-mcp-dupe-"));
  try {
    const userData = path.join(root, "user-data");
    await mkdir(userData, { recursive: true });
    const first = path.join(root, "claude.json");
    const second = path.join(root, "cursor.json");
    await writeFile(first, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: ["first"], env: {} } } }));
    await writeFile(second, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: ["second"], env: {} }, other: { command: process.execPath, args: [], env: {} } } }));
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "claude", skillRoots: [], mcpFiles: [first] }, { id: "cursor", skillRoots: [], mcpFiles: [second] }] }));
    const listed = await new ImportedCapabilityRuntime(userData).listMcpServers();
    assert.deepEqual(listed.map((server) => server.id), ["mcp:claude:0:github", "mcp:cursor:0:other"]);
    assert.deepEqual((await harnessMcpServers(userData)).map((server) => [server.name, "args" in server ? server.args : []]), [["github", ["first"]], ["other", []]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symlinked skill directory attaches and previews, and a CRLF SKILL.md keeps its own frontmatter", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "shinbo-symlink-skill-")));
  try {
    const userData = path.join(root, "user-data");
    const harnessHome = path.join(userData, "harness");
    const skills = path.join(root, "skills");
    const target = path.join(root, "agents", "skills", "linked");
    await mkdir(skills, { recursive: true });
    await mkdir(userData, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), "---\r\nname: linked\r\ndescription: Linked in.\r\n---\r\nFollow the link.\r\n");
    await symlink(target, path.join(skills, "linked"));
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "claude", skillRoots: [skills], mcpFiles: [] }] }));
    assert.equal((await loadImportedSkill(userData, "skill:claude:0:linked")).instructions, "---\r\nname: linked\r\ndescription: Linked in.\r\n---\r\nFollow the link.\r\n");
    assert.equal((await previewImportedSkill(userData, "linked"))?.path, path.join(target, "SKILL.md"));
    assert.deepEqual(await mirrorSkillsToHarness(userData, harnessHome), ["linked"]);
    assert.equal(await readFile(path.join(harnessHome, ".fx", "skills", "linked", "SKILL.md"), "utf8"), "---\r\nname: linked\r\ndescription: Linked in.\r\n---\r\nFollow the link.\r\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a skill the harness installed is neither overwritten nor removed by a same-named import", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "shinbo-shadowed-skill-")));
  try {
    const userData = path.join(root, "user-data");
    const harnessHome = path.join(userData, "harness");
    const installed = path.join(harnessHome, ".fx", "skills", "deploy");
    const skills = path.join(root, "skills", "deploy");
    await mkdir(installed, { recursive: true });
    await mkdir(skills, { recursive: true });
    await writeFile(path.join(installed, "SKILL.md"), "---\nname: deploy\ndescription: Cloned.\n---\nFrom the clone.\n");
    await writeFile(path.join(installed, "helper.sh"), "echo clone\n");
    await writeFile(path.join(skills, "SKILL.md"), "---\nname: deploy\ndescription: Imported.\n---\nFrom the import.\n");
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [{ id: "claude", skillRoots: [path.dirname(skills)], mcpFiles: [] }] }));
    assert.deepEqual(await mirrorSkillsToHarness(userData, harnessHome), []);
    assert.equal(await readFile(path.join(installed, "SKILL.md"), "utf8"), "---\nname: deploy\ndescription: Cloned.\n---\nFrom the clone.\n");
    await writeFile(path.join(userData, "imports.json"), JSON.stringify({ version: 1, sources: [] }));
    assert.deepEqual(await mirrorSkillsToHarness(userData, harnessHome), ["deploy"]);
    assert.equal(await readFile(path.join(installed, "helper.sh"), "utf8"), "echo clone\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex-style MCP TOML stays main-side and supports stdio metadata", () => {
  const [server] = parseMcpConfig('[mcp_servers."fixture"]\ncommand = "node"\nargs = ["server.js"]\nenv = { API_KEY = "secret" }\n', "config.toml", "codex", 0);
  assert.equal(server.id, "mcp:codex:0:fixture");
  assert.deepEqual(server.args, ["server.js"]);
  assert.equal(server.env.API_KEY, "secret");
});

test("JSONC parsing removes trailing commas without changing string values", () => {
  const [server] = parseMcpConfig('{"mcpServers":{"fixture":{"command":"node","args":[],"env":{"TOKEN":"keep,}"},},},}', "config.jsonc");
  assert.equal(server.env.TOKEN, "keep,}");
});
