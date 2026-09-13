import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "0.37.1";
const BINARIES = {
  darwin: {
    arm64: { asset: "agent-browser-darwin-arm64", sha256: "e52f06476ea0f1d14357c1924ce1d7f1bf08279f2642d74ccfa7ee935c46aea1" },
    x64: { asset: "agent-browser-darwin-x64", sha256: "c79d1e0525c0bf79df9eec355269ae40bcda9c4a3fce3f242c24faecaaaeef84" },
  },
  win32: {
    x64: { asset: "agent-browser-win32-x64.exe", sha256: "29a003139ff4eb96fa4d1ed341830b26eb3e082843bf776b4e88ad3443bb8fde" },
  },
};

const vendor = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor");
const executable = process.platform === "win32" ? "agent-browser.exe" : "agent-browser";
const binary = path.join(vendor, executable);
const stamp = path.join(vendor, "agent-browser.version");
const want = `agent-browser ${VERSION} ${process.platform} ${process.arch}\n`;
const spec = BINARIES[process.platform]?.[process.arch];

if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, "utf8") === want) {
  console.log(`agent-browser ${VERSION} already vendored.`);
  process.exit(0);
}

if (!spec) {
  console.warn(`No pinned agent-browser for ${process.platform}/${process.arch}; Shinbo will use the agent-browser already on this machine.`);
  process.exit(0);
}

const url = `https://github.com/vercel-labs/agent-browser/releases/download/v${VERSION}/${spec.asset}`;
console.log(`Fetching ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`agent-browser download failed: ${response.status} ${response.statusText}`);
const bytes = Buffer.from(await response.arrayBuffer());

const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== spec.sha256) throw new Error(`agent-browser checksum mismatch: expected ${spec.sha256}, got ${digest}. Nothing was written.`);

mkdirSync(vendor, { recursive: true });
writeFileSync(binary, bytes);
if (process.platform !== "win32") chmodSync(binary, 0o755);
writeFileSync(stamp, want);
console.log(`Vendored agent-browser ${VERSION} to ${binary}`);
