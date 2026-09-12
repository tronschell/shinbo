import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const bin = path.dirname(
  require.resolve("@remotion/compositor-darwin-arm64/package.json"),
);
const cuts = [
  ["prompt", "launch-briefing", 3, 6],
  ["plan", "launch-briefing", 180, 5],
  ["delegation", "launch-briefing", 199, 5],
  ["browser", "launch-briefing", 128.5, 6],
  ["reply", "launch-briefing", 440, 5],
  ["model-reel", "launch-build", 521, 5],
  ["model-routes", "launch-briefing", 503, 5],
  ["workflow-first", "launch-briefing", 390, 3.5],
  ["workflow-last", "launch-briefing", 408, 3.5],
  ["plugins", "features-window", 69, 5],
  ["result", "orbit-final", 8, 7],
  ["interact", "orbit-final", 31, 8],
];
for (const [name, source, start, duration] of cuts) {
  const result = spawnSync(
    path.join(bin, "ffmpeg"),
    [
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(start),
      "-i",
      `out/raw/${source}.mov`,
      "-t",
      String(duration),
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "17",
      "-an",
      `public/captures/${name}.mp4`,
    ],
    { stdio: "inherit", env: { ...process.env, DYLD_LIBRARY_PATH: bin } },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

writeFileSync("out/workflow-cuts.txt", ["first", "last"].map((part) => `file '${path.resolve(`public/captures/workflow-${part}.mp4`)}'`).join("\n"));
const joined = spawnSync(path.join(bin, "ffmpeg"), ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "out/workflow-cuts.txt", "-c", "copy", "public/captures/workflow.mp4"], {stdio: "inherit", env: {...process.env, DYLD_LIBRARY_PATH: bin}});
if (joined.status !== 0) process.exit(joined.status ?? 1);
