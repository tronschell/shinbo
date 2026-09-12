import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const bin = path.dirname(
  require.resolve("@remotion/compositor-darwin-arm64/package.json"),
);
function probe(file) {
  const result = spawnSync(
    path.join(bin, "ffprobe"),
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { encoding: "utf8", env: { ...process.env, DYLD_LIBRARY_PATH: bin } },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
for (const name of [
  "prompt", "plan", "delegation", "browser", "reply", "model-reel", "model-routes", "workflow", "plugins", "result", "interact",
]) {
  const media = probe(`public/captures/${name}.mp4`);
  assert.ok(
    Number(media.format.duration) + 2 / 30 + 0.000001 >=
      ({browser: 5, workflow: 7, result: 6, interact: 7, reply: 4}[name] ?? 4),
  );
  assert.equal(media.streams[0].width, 2984);
  assert.equal(media.streams[0].height, 1944);
}
const final = probe("out/shinbo-4k.mp4");
const video = final.streams.find((s) => s.codec_type === "video");
const audio = final.streams.find((s) => s.codec_type === "audio");
assert.equal(video.width, 3840);
assert.equal(video.height, 2160);
assert.equal(video.r_frame_rate, "30/1");
assert.equal(Number(video.nb_frames), 1800);
assert.ok(audio);
assert.ok(Math.abs(Number(final.format.duration) - 60) < 0.1);
console.log(
  "Verified: 3840 × 2160, 30 fps, 1,800 frames, 60 seconds, audio present; all eleven source clips valid.",
);
