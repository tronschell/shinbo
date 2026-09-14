import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import { attachmentLimit, isConvertibleImage, isImageAttachment, MAX_FILE_BYTES, MAX_IMAGE_BYTES, oversizeMessage } from "../shared/folders";
import { writeAtomicSync } from "./write-atomic";

export { isConvertibleImage, isImageAttachment, MAX_IMAGE_BYTES };

export type Attachment = { id: string; name: string; path: string };

export const MAX_MODEL_IMAGE_BYTES = 1024 * 1024;
export const MAX_MODEL_IMAGE_EDGE = 1568;

const exec = promisify(execFile);

type ImageSize = { height: number } | { maxEdge: number } | { maxWidth: number } | { convert: true };

let imagePreparation: Promise<void> = Promise.resolve();

function resizedPng(file: string, size: ImageSize): Promise<Buffer | undefined> {
  const next = imagePreparation.then(() => preparePng(file, size));
  imagePreparation = next.then(() => undefined, () => undefined);
  return next;
}

async function preparePng(file: string, size: ImageSize): Promise<Buffer | undefined> {
  if (process.platform !== "darwin") return undefined;
  const { dir, name, ext } = path.parse(file);
  const scales = ["1", "1.25", "1.33", "1.4", "1.5", "1.8", "2", "2.5", "3", "4", "5"];
  if (!("convert" in size) && (/@[\d.]+x$/.test(name) || (await Promise.all(scales.map((scale) =>
    access(path.join(dir, `${name}@${scale}x${ext}`)).then(() => true, () => false)))).some(Boolean))) return undefined;
  let directory: string | undefined;
  try {
    let resize: string[];
    if ("convert" in size) resize = [];
    else if ("height" in size) resize = ["--resampleHeight", String(size.height)];
    else {
      const { stdout } = await exec("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 10_000, maxBuffer: 16 * 1024 });
      const width = Number(/pixelWidth:\s+(\d+)/.exec(stdout)?.[1]);
      const height = Number(/pixelHeight:\s+(\d+)/.exec(stdout)?.[1]);
      const limit = "maxWidth" in size ? size.maxWidth : size.maxEdge;
      const longest = "maxWidth" in size ? width : Math.max(width, height);
      if (!width || !height || longest <= limit) return undefined;
      const ratio = limit / longest;
      resize = ["--resampleHeightWidth", String(Math.max(1, Math.round(height * ratio))), String(Math.max(1, Math.round(width * ratio)))];
    }
    directory = await mkdtemp(path.join(tmpdir(), "shinbo-image-"));
    const preview = path.join(directory, "image.png");
    await exec("/usr/bin/sips", ["-s", "format", "png", ...resize, file, "--out", preview], { timeout: 10_000, maxBuffer: 16 * 1024 });
    const png = await readFile(preview);
    return png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? png : undefined;
  } catch {
    return undefined;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function attachmentImage(file: string, size: ImageSize): Promise<Electron.NativeImage> {
  const png = await resizedPng(file, size);
  if (png) {
    const image = nativeImage.createFromBuffer(png);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createFromPath(file);
}

export async function convertedPng(file: string): Promise<{ name: string; data: Buffer } | undefined> {
  if (!isConvertibleImage(file)) return undefined;
  const png = await resizedPng(file, { convert: true });
  return png ? { name: `${path.parse(file).name}.png`, data: png } : undefined;
}

export async function convertedPngBytes(rawName: unknown, data: Uint8Array): Promise<{ name: string; data: Buffer } | undefined> {
  const name = safeName(rawName);
  if (!isConvertibleImage(name) || data.byteLength > MAX_IMAGE_BYTES) return undefined;
  const directory = await mkdtemp(path.join(tmpdir(), "shinbo-convert-"));
  try {
    const source = path.join(directory, name);
    await writeFile(source, data);
    return await convertedPng(source);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const MAX_CACHED_PREVIEWS = 24;
const previews = new Map<string, string>();

async function freshPreview(file: string, maxWidth: number): Promise<string | null> {
  const png = await resizedPng(file, { maxWidth });
  if (png) return `data:image/png;base64,${png.toString("base64")}`;
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  if (image.getSize().width > maxWidth) return image.resize({ width: maxWidth }).toDataURL();
  const type = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${type};base64,${(await readFile(file)).toString("base64")}`;
}

export async function attachmentPreview(file: string, maxWidth: number): Promise<string | null> {
  let key: string;
  try { key = `${file}:${statSync(file).mtimeMs}:${maxWidth}`; } catch { return null; }
  const cached = previews.get(key);
  if (cached) {
    previews.delete(key);
    previews.set(key, cached);
    return cached;
  }
  const preview = await freshPreview(file, maxWidth);
  if (!preview) return null;
  previews.set(key, preview);
  if (previews.size > MAX_CACHED_PREVIEWS) previews.delete(previews.keys().next().value!);
  return preview;
}

function checkText(name: string, bytes: Uint8Array) {
  if (isConvertibleImage(name)) {
    throw new Error(process.platform === "darwin"
      ? `${name} could not be converted to PNG; save it as PNG or JPEG and attach that.`
      : `${name} can only be converted on macOS; save it as PNG or JPEG and attach that.`);
  }
  if (bytes.includes(0)) throw new Error(`${name} is not a text file, so there is nothing to attach.`);
}

function safeName(value: unknown): string {
  const name = typeof value === "string" ? path.basename(value).replace(/[/\\]/g, "").trim() : "";
  if (!name || name.startsWith(".") || name.length > 128) throw new Error("That file name cannot be attached.");
  return name;
}

export class AttachmentStore {
  private readonly directory: string;
  private readonly index: string;
  private readonly held = new Map<string, Attachment>();
  private readonly paths = new Set<string>();

  constructor(userData: string) {
    this.directory = path.join(userData, "attachments");
    this.index = path.join(this.directory, "held.json");
    try {
      const stored = JSON.parse(readFileSync(this.index, "utf8")) as unknown;
      if (Array.isArray(stored)) {
        for (const item of stored as Attachment[]) {
          if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string") continue;
          if (!existsSync(item.path)) continue;
          this.held.set(item.id, { id: item.id, name: item.name, path: item.path });
          this.paths.add(item.path);
        }
      }
    } catch { return; }
  }

  hold(file: string): Attachment {
    const full = realpathSync(file);
    const stats = statSync(full);
    if (!stats.isFile()) throw new Error("That is not a file.");
    const name = path.basename(full);
    this.check(name, stats.size);
    if (!isImageAttachment(name)) checkText(name, readFileSync(full));
    const attachment = { id: randomUUID(), name, path: full };
    this.remember(attachment);
    return attachment;
  }

  save(rawName: unknown, data: Uint8Array): Attachment {
    const name = safeName(rawName);
    this.check(name, data.byteLength);
    if (!isImageAttachment(name)) checkText(name, data);
    const id = randomUUID();
    mkdirSync(this.directory, { recursive: true });
    const full = path.join(this.directory, `${id}-${name}`);
    const attachment = { id, name, path: full };
    try {
      writeFileSync(full, data);
      this.remember(attachment);
      return attachment;
    } catch (error) {
      try { rmSync(full, { force: true }); } catch { throw error; }
      throw error;
    }
  }

  read(id: unknown): Attachment & { text?: string } {
    const attachment = typeof id === "string" ? this.held.get(id) : undefined;
    if (!attachment) throw new Error("That attachment is no longer held.");
    if (isImageAttachment(attachment.name)) return { ...attachment };
    if (statSync(attachment.path).size > MAX_FILE_BYTES) throw new Error(`${attachment.name} is larger than an attachment can carry.`);
    const bytes = readFileSync(attachment.path);
    checkText(attachment.name, bytes);
    return { ...attachment, text: bytes.toString("utf8") };
  }

  async forModel(attachment: Attachment): Promise<string> {
    if (!isImageAttachment(attachment.name)) return attachment.path;
    try {
      const source = statSync(attachment.path);
      if (source.size <= MAX_MODEL_IMAGE_BYTES) return attachment.path;
      const smaller = path.join(this.directory, `${attachment.id}-model.jpg`);
      if (existsSync(smaller) && statSync(smaller).mtimeMs >= source.mtimeMs) return smaller;
      const image = await attachmentImage(attachment.path, { maxEdge: MAX_MODEL_IMAGE_EDGE });
      if (image.isEmpty()) return attachment.path;
      const { width, height } = image.getSize();
      const longest = Math.max(width, height);
      const fitted = longest > MAX_MODEL_IMAGE_EDGE
        ? image.resize({ width: Math.round(width * MAX_MODEL_IMAGE_EDGE / longest), height: Math.round(height * MAX_MODEL_IMAGE_EDGE / longest), quality: "good" })
        : image;
      let bytes = fitted.toJPEG(80);
      if (bytes.byteLength > MAX_MODEL_IMAGE_BYTES) bytes = fitted.toJPEG(45);
      const current = statSync(attachment.path);
      if (current.mtimeMs !== source.mtimeMs || current.ctimeMs !== source.ctimeMs || current.size !== source.size || current.ino !== source.ino) return attachment.path;
      mkdirSync(this.directory, { recursive: true });
      writeAtomicSync(smaller, bytes);
      return smaller;
    } catch { return attachment.path; }
  }



  holds(file: string): boolean {
    return this.paths.has(file);
  }

  private check(name: string, bytes: number) {
    if (bytes > attachmentLimit(name)) throw new Error(oversizeMessage(name, bytes));
  }

  private remember(attachment: Attachment) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeAtomicSync(this.index, `${JSON.stringify([...this.held.values(), attachment])}\n`);
    this.held.set(attachment.id, attachment);
    this.paths.add(attachment.path);
  }
}
