import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { app, nativeImage } from "electron";
const load = createRequire(import.meta.url);
const after = load(process.env.SHINBO_IMAGE_MODULE || "../dist-main/main/attachments.js");
const before = process.env.SHINBO_IMAGE_BASELINE ? load(process.env.SHINBO_IMAGE_BASELINE) : undefined;
const root = mkdtempSync(path.join(tmpdir(), "shinbo-image-perf-"));
const modes = before ? [["before", before], ["after", after]] : [["after", after]];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temporaryImages = () => readdirSync(tmpdir()).filter((name) => name.startsWith("shinbo-image-") && !name.startsWith("shinbo-image-perf-"));
app.setPath("userData", path.join(root, "profile"));

app.whenReady().then(async () => {
  const width = 8000, height = 6000;
  const pixels = Buffer.alloc(width * height * 4);
  let seed = 13;
  for (let at = 0; at < pixels.length; at += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[at] = seed & 255;
    pixels[at + 1] = (seed >>> 8) & 255;
    pixels[at + 2] = (seed >>> 16) & 255;
    pixels[at + 3] = 255;
  }
  const file = path.join(root, "photo.jpg");
  const original = nativeImage.createFromBitmap(pixels, { width, height }).toJPEG(15);
  writeFileSync(file, original);
  assert.ok(original.length > after.MAX_MODEL_IMAGE_BYTES && original.length <= after.MAX_IMAGE_BYTES);
  console.log(JSON.stringify({ fixture: { width, height, bytes: original.length } }));
  const temporaryBefore = temporaryImages();
  for (const task of ["thumbnail", "model"]) for (let run = 0; run < 4; run++) for (const [mode, module] of modes) {
    const home = path.join(root, `${task}-${run}-${mode}`);
    mkdirSync(home);
    const store = new module.AttachmentStore(home);
    const held = store.hold(file);
    let previous = performance.now(), maxGap = 0;
    const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; }, 1);
    await pause(10);
    const start = performance.now();
    const output = task === "model"
      ? await store.forModel(held)
      : (mode === "before" ? nativeImage.createFromPath(file) : await after.attachmentImage(file, { height: 112 })).resize({ height: 112 }).toDataURL();
    const elapsed = performance.now() - start;
    await pause(10);
    clearInterval(timer);
    const image = task === "model" ? nativeImage.createFromPath(output) : nativeImage.createFromDataURL(output);
    assert.deepEqual(image.getSize(), task === "model" ? { width: 1568, height: 1176 } : { width: 149, height: 112 });
    if (task === "model") {
      assert.ok(statSync(output).size < after.MAX_MODEL_IMAGE_BYTES);
      const changed = statSync(output).mtimeMs;
      assert.equal(await store.forModel(held), output);
      assert.equal(statSync(output).mtimeMs, changed);
    }
    console.log(JSON.stringify({ task, run, mode, elapsed, maxGap, size: image.getSize(), bytes: task === "model" ? statSync(output).size : output.length }));
  }
  assert.deepEqual(readFileSync(file), original);
  const corners = Buffer.alloc(300 * 200 * 4);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
    const at = (y * 300 + x) * 4;
    corners[at] = x < 150 ? 0 : 255;
    corners[at + 1] = y < 100 ? 0 : 255;
    corners[at + 2] = x < 150 ? 255 : 0;
    corners[at + 3] = 255;
  }
  const jpeg = nativeImage.createFromBitmap(corners, { width: 300, height: 200 }).toJPEG(95);
  const exif = Buffer.from("ffe1002245786966000049492a0008000000010012010300010000000600000000000000", "hex");
  const rotated = path.join(root, "orientation.jpg");
  writeFileSync(rotated, Buffer.concat([jpeg.subarray(0, 20), exif, jpeg.subarray(20)]));
  const source = nativeImage.createFromPath(rotated);
  const converted = await after.attachmentImage(rotated, { maxEdge: 200 });
  assert.deepEqual(converted.getSize(), { width: 200, height: 133 });
  const cornerPixels = (image) => {
    const { width, height } = image.getSize();
    const bytes = image.toBitmap();
    return [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].flatMap(([x, y]) => [...bytes.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]);
  };
  const first = cornerPixels(source), second = cornerPixels(converted);
  first.forEach((value, at) => assert.ok(Math.abs(value - second[at]) <= 4));
  assert.deepEqual((await after.attachmentImage(rotated, { maxEdge: 1568 })).getSize(), source.getSize());
  assert.deepEqual((await after.attachmentImage(rotated, { maxWidth: 200 })).getSize(), { width: 200, height: 133 });
  assert.deepEqual((await after.attachmentImage(rotated, { maxWidth: 1568 })).getSize(), source.getSize());
  const portrait = path.join(root, "portrait.png");
  writeFileSync(portrait, nativeImage.createFromBitmap(corners, { width: 200, height: 300 }).toPNG());
  assert.deepEqual((await after.attachmentImage(portrait, { maxWidth: 100 })).getSize(), { width: 100, height: 150 });
  assert.deepEqual(nativeImage.createFromDataURL(await after.attachmentPreview(portrait, 100)).getSize(), { width: 100, height: 150 });
  const retina = path.join(root, "orientation@2x.jpg");
  writeFileSync(retina, readFileSync(rotated));
  assert.deepEqual((await after.attachmentImage(retina, { height: 112 })).getScaleFactors(), [2]);
  assert.deepEqual((await after.attachmentImage(rotated, { height: 112 })).getScaleFactors(), nativeImage.createFromPath(rotated).getScaleFactors());
  const transparent = path.join(root, "transparent.png");
  corners.fill(0, 0, 300 * 100 * 4);
  writeFileSync(transparent, nativeImage.createFromBitmap(corners, { width: 300, height: 200 }).toPNG());
  assert.equal((await after.attachmentImage(transparent, { height: 112 })).toBitmap()[3], 0);
  const corrupt = path.join(root, "corrupt.png");
  writeFileSync(corrupt, Buffer.alloc(after.MAX_MODEL_IMAGE_BYTES + 1));
  const store = new after.AttachmentStore(root);
  assert.ok((await after.attachmentImage(corrupt, { height: 112 })).isEmpty());
  const rejected = store.hold(corrupt);
  assert.equal(await store.forModel(rejected), rejected.path);
  assert.deepEqual(temporaryImages(), temporaryBefore);
  console.log(JSON.stringify({ verified: ["ordered image dimensions", "existing JPEG size cap", "unchanged original", "cached model copy", "EXIF fixture corner orientation", "no model upscaling", "portrait width cap", "Retina representations", "PNG transparency", "corrupt fallback", "temporary cleanup"] }));
}).finally(() => rmSync(root, { recursive: true, force: true })).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
