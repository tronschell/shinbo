









import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import { isImageAttachment, MAX_FILE_BYTES } from "../shared/folders";
import { writeAtomicSync } from "./write-atomic";

export { isImageAttachment };


export type Attachment = { id: string; name: string; path: string };


export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_MODEL_IMAGE_BYTES = 1024 * 1024;
export const MAX_MODEL_IMAGE_EDGE = 1568;

const exec = promisify(execFile);

type ImageSize = { height: number } | { maxEdge: number } | { maxWidth: number };

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
  if (/@[\d.]+x$/.test(name) || (await Promise.all(scales.map((scale) =>
    access(path.join(dir, `${name}@${scale}x${ext}`)).then(() => true, () => false)))).some(Boolean)) return undefined;
  let directory: string | undefined;
  try {
    let resize: string[];
    if ("height" in size) resize = ["--resampleHeight", String(size.height)];
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

export async function attachmentPreview(file: string, maxWidth: number): Promise<string | null> {
  const png = await resizedPng(file, { maxWidth });
  if (png) return `data:image/png;base64,${png.toString("base64")}`;
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  return (image.getSize().width > maxWidth ? image.resize({ width: maxWidth }) : image).toDataURL();
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




  constructor(userData: string) {
    this.directory = path.join(userData, "attachments");
    this.index = path.join(this.directory, "held.json");
    try {
      const stored = JSON.parse(readFileSync(this.index, "utf8")) as unknown;
      if (Array.isArray(stored)) {
        for (const item of stored as Attachment[]) {


          if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string") continue;
          if (existsSync(item.path)) this.held.set(item.id, { id: item.id, name: item.name, path: item.path });
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
    const attachment = { id: randomUUID(), name, path: full };
    this.remember(attachment);
    return attachment;
  }


  save(rawName: unknown, data: Uint8Array): Attachment {
    const name = safeName(rawName);
    this.check(name, data.byteLength);
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


    if (bytes.includes(0)) throw new Error(`${attachment.name} is not a text file, so there is nothing to attach.`);
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
    for (const attachment of this.held.values()) if (attachment.path === file) return true;
    return false;
  }

  private check(name: string, bytes: number) {
    const max = isImageAttachment(name) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (bytes > max) throw new Error(`${name} is ${Math.round(bytes / 1024)} KB; attachments stop at ${Math.round(max / 1024)} KB.`);
  }

  private remember(attachment: Attachment) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeAtomicSync(this.index, `${JSON.stringify([...this.held.values(), attachment], null, 2)}\n`);
    this.held.set(attachment.id, attachment);
  }


}
