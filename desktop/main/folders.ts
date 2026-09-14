import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { isPreviewImage, MAX_BLOB_BYTES, MAX_FILE_BYTES, MAX_FOLDER_COUNT, MAX_FOLDER_FILES, MAX_FOLDER_PATHS, MAX_FOLDERS, MAX_OPEN_BYTES, missingFolderMessage, type FolderBlob, type FolderEntry, type FolderFile, type FolderGrant, type FolderListing } from "../shared/folders";
import { pathInside, realPath, realPathInside, samePath } from "./platform";
import { writeAtomicSync } from "./write-atomic";

const SKIP_DIRECTORIES = new Set(["node_modules", "target", "dist", "dist-main", "dist-native", "dist-renderer", "build", "coverage", "out", "zig-cache", "zig-out", "__pycache__", ".venv", "vendor"]);
const TEXT_FILE = /\.(md|markdown|txt|rst|org|json|jsonc|ya?ml|toml|ini|csv|tsv|tsx?|jsx?|mjs|cjs|rs|zig|py|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|sql|css|scss|html?|xml|tex|env|gitignore)$/i;
const MAX_DEPTH = 6;
const MAX_PATH_DEPTH = 12;

function imageMime(name: string): string {
  const kind = path.extname(name).slice(1).toLowerCase();
  return kind === "svg" ? "image/svg+xml" : kind === "ico" ? "image/x-icon" : `image/${kind === "jpg" ? "jpeg" : kind}`;
}

export class FolderStore {
  private readonly file: string;
  private grants: FolderGrant[] = [];

  constructor(userData: string) {
    this.file = path.join(userData, "folders.json");
    try {
      const stored = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (Array.isArray(stored)) {
        this.grants = stored.filter((item): item is FolderGrant =>
          !!item && typeof item === "object" && typeof (item as FolderGrant).id === "string" && typeof (item as FolderGrant).path === "string" && typeof (item as FolderGrant).name === "string")
          .slice(0, MAX_FOLDERS)
          .map((grant) => ({ id: grant.id, path: grant.path, name: grant.name, ...(typeof grant.vault === "boolean" ? { vault: grant.vault } : {}) }));
      }
    } catch { this.grants = []; }
  }

  list(): FolderGrant[] {
    return this.grants.map((grant) => ({ ...grant }));
  }

  add(directory: string, vault = false): FolderGrant[] {
    const resolved = realpathSync.native(directory);
    if (!statSync(resolved).isDirectory()) throw new Error("That is not a folder.");
    if (!this.grants.some((grant) => samePath(grant.path, resolved))) {
      if (this.grants.length >= MAX_FOLDERS) throw new Error(`Shinbo keeps at most ${MAX_FOLDERS} folders; remove one first.`);
      this.grants.push({ id: randomUUID(), path: resolved, name: path.basename(resolved) || resolved, ...(vault ? { vault } : {}) });
      this.save();
    }
    return this.list();
  }

  markVault(id: string, owned: boolean): void {
    const grant = this.grants.find((item) => item.id === id);
    if (!grant || grant.vault !== undefined) return;
    grant.vault = owned;
    this.save();
  }

  remove(id: string): FolderGrant[] {
    const kept = this.grants.filter((grant) => grant.id !== id);
    if (kept.length !== this.grants.length) { this.grants = kept; this.save(); }
    return this.list();
  }

  async files(id: string): Promise<FolderListing> {
    const root = this.root(id);
    const found: FolderFile[] = [];
    let total = 0;
    let visited = 0;
    const maxEntries = MAX_FOLDER_COUNT * 8;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (let offset = 0; offset < entries.length; offset += 32) {
        const batch = entries.slice(offset, offset + Math.min(32, maxEntries - visited));
        const stats = await Promise.all(batch.map((entry) =>
          !entry.name.startsWith(".") && !SKIP_DIRECTORIES.has(entry.name) && entry.isFile() && TEXT_FILE.test(entry.name)
            ? stat(path.join(directory, entry.name)).catch(() => undefined) : undefined));
        for (const [index, entry] of batch.entries()) {
          if (total >= MAX_FOLDER_COUNT || visited >= maxEntries) return;
          visited += 1;
          if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(full, depth + 1);
          else {
            const info = stats[index];
            if (!info || info.size > MAX_FILE_BYTES) continue;
            total += 1;
            if (found.length < MAX_FOLDER_FILES) found.push({ path: path.relative(root, full), bytes: info.size });
          }
        }
        if (total >= MAX_FOLDER_COUNT || visited >= maxEntries) return;
      }
    };
    await walk(root, 0);
    return { files: found.sort((left, right) => left.path.localeCompare(right.path)), total, capped: total >= MAX_FOLDER_COUNT || visited >= maxEntries };
  }

  async paths(id: string): Promise<{ paths: string[]; capped: boolean }> {
    const root = this.root(id);
    const found: string[] = [];
    let level = [root];
    for (let depth = 0; depth <= MAX_PATH_DEPTH && level.length > 0 && found.length < MAX_FOLDER_PATHS; depth += 1) {
      const next: string[] = [];
      for (let offset = 0; offset < level.length; offset += 32) {
        const listed = await Promise.all(level.slice(offset, offset + 32).map(async (directory) =>
          [directory, await readdir(directory, { withFileTypes: true }).catch(() => [])] as const));
        for (const [directory, entries] of listed) {
          for (const entry of entries) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
              if (!SKIP_DIRECTORIES.has(entry.name) && entry.name !== ".git") next.push(full);
            } else if (entry.isFile() && found.length < MAX_FOLDER_PATHS) {
              found.push(path.relative(root, full).split(path.sep).join("/"));
            }
          }
        }
      }
      level = next;
    }
    return { paths: found.sort(), capped: found.length >= MAX_FOLDER_PATHS };
  }

  read(id: string, relative: string): { path: string; text: string; missing?: boolean } {
    const root = this.root(id);
    const target = path.resolve(root, relative);
    if (!pathInside(root, target)) throw new Error("That file is outside the granted folder.");
    if (!this.exists(target)) return { path: path.relative(root, target), text: "", missing: true };
    const full = realpathSync.native(target);
    if (!pathInside(root, full)) throw new Error("That file is outside the granted folder.");
    if (!statSync(full).isFile() || statSync(full).size > MAX_OPEN_BYTES) throw new Error("That file cannot be attached.");
    return { path: path.relative(root, full), text: readFileSync(full, "utf8") };
  }

  async entries(id: string, relative: string): Promise<FolderEntry[]> {
    const root = this.root(id);
    const directory = relative === "" || relative === "." ? root : this.contain(root, relative);
    if (!(await stat(directory).catch(() => undefined))?.isDirectory()) throw new Error("That path is not a folder.");
    const listed = (await readdir(directory, { withFileTypes: true })).slice(0, MAX_FOLDER_COUNT);
    const found = await Promise.all(listed.map(async (entry) => {
      const info = await stat(path.join(directory, entry.name)).catch(() => undefined);
      return { name: entry.name, kind: (info ? info.isDirectory() : entry.isDirectory()) ? "dir" as const : "file" as const, bytes: info?.isFile() ? info.size : 0 };
    }));
    return found.sort((left, right) => left.kind === right.kind
      ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      : left.kind === "dir" ? -1 : 1);
  }

  blob(id: string, relative: string): FolderBlob {
    const root = this.root(id);
    const full = this.contain(root, relative);
    if (!isPreviewImage(full)) throw new Error("That file cannot be previewed here.");
    const stats = statSync(full);
    if (!stats.isFile()) throw new Error("That file cannot be previewed here.");
    if (stats.size > MAX_BLOB_BYTES) throw new Error(`Shinbo previews images up to ${Math.round(MAX_BLOB_BYTES / 1024 / 1024)} MB.`);
    return { path: path.relative(root, full), mime: imageMime(full), dataUrl: `data:${imageMime(full)};base64,${readFileSync(full).toString("base64")}`, bytes: stats.size };
  }

  write(id: string, relative: string, text: string, previous?: string): { path: string; before: string | null } {
    const root = this.root(id);
    if (Buffer.byteLength(text, "utf8") > MAX_OPEN_BYTES) throw new Error(`Shinbo writes at most ${MAX_OPEN_BYTES} bytes to one file.`);
    const full = this.contain(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    let before: string | null = null;
    let destination = full;
    let mode = 0o600;
    let present = false;
    try {
      const stats = statSync(full);
      if (!stats.isFile()) throw new Error("That path is not a file.");
      present = true;
      destination = realpathSync.native(full);
      mode = stats.mode & 0o777;
      if (stats.size <= MAX_OPEN_BYTES) before = readFileSync(full, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (typeof previous === "string" && (present ? before : "") !== previous) throw new Error("That file changed on disk since you opened it — reload it first.");
    writeAtomicSync(destination, text, mode);
    return { path: path.relative(root, full), before };
  }

  directory(id: string): string {
    return this.root(id);
  }

  within(id: string, relative: string): string {
    const root = this.root(id);
    if (!path.isAbsolute(relative) && samePath(path.resolve(root, relative), root)) return ".";
    return path.relative(root, this.contain(root, relative));
  }

  fileWithin(id: string, given: string): string {
    const root = this.root(id);
    const relative = path.isAbsolute(given) ? path.relative(root, realPath(given) ?? given) : given;
    if (path.isAbsolute(relative)) throw new Error("That file is outside the granted folder.");
    return path.join(root, this.within(id, relative));
  }

  private contain(root: string, relative: string): string {
    if (path.isAbsolute(relative)) throw new Error("Name the file relative to the granted folder.");
    const target = path.resolve(root, relative);
    if (!realPathInside(root, target)) throw new Error("That file is outside the granted folder.");
    return target;
  }

  private exists(directory: string): boolean {
    try { statSync(directory); return true; } catch { return false; }
  }

  private root(id: string): string {
    const grant = this.grants.find((item) => item.id === id);
    if (!grant) throw new Error("That folder is no longer connected.");
    try {
      return realpathSync.native(grant.path);
    } catch {
      throw new Error(missingFolderMessage(grant.name, grant.path));
    }
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.grants, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
