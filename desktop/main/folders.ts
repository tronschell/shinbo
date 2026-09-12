import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { MAX_FILE_BYTES, MAX_FOLDER_COUNT, MAX_FOLDER_FILES, MAX_FOLDERS, missingFolderMessage, type FolderFile, type FolderGrant, type FolderListing } from "../shared/folders";
import { pathInside, realPath, realPathInside, samePath } from "./platform";
import { writeAtomicSync } from "./write-atomic";

const SKIP_DIRECTORIES = new Set(["node_modules", "target", "dist", "dist-main", "dist-native", "dist-renderer", "build", "coverage", "out", "zig-cache", "zig-out", "__pycache__", ".venv", "vendor"]);
const TEXT_FILE = /\.(md|markdown|txt|rst|org|json|jsonc|ya?ml|toml|ini|csv|tsv|tsx?|jsx?|mjs|cjs|rs|zig|py|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|sql|css|scss|html?|xml|tex|env|gitignore)$/i;
const MAX_DEPTH = 6;

export class FolderStore {
  private readonly file: string;
  private grants: FolderGrant[] = [];

  constructor(userData: string) {
    this.file = path.join(userData, "folders.json");
    try {
      const stored = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (Array.isArray(stored)) {
        this.grants = stored.filter((item): item is FolderGrant =>
          !!item && typeof item === "object" && typeof (item as FolderGrant).id === "string" && typeof (item as FolderGrant).path === "string" && typeof (item as FolderGrant).name === "string").slice(0, MAX_FOLDERS);
      }
    } catch { this.grants = []; }
  }

  list(): FolderGrant[] {
    return this.grants.map((grant) => ({ ...grant }));
  }

  add(directory: string): FolderGrant[] {
    const resolved = realpathSync.native(directory);
    if (!statSync(resolved).isDirectory()) throw new Error("That is not a folder.");
    if (!this.grants.some((grant) => samePath(grant.path, resolved))) {
      if (this.grants.length >= MAX_FOLDERS) throw new Error(`Shinbo keeps at most ${MAX_FOLDERS} folders; remove one first.`);
      this.grants.push({ id: randomUUID(), path: resolved, name: path.basename(resolved) || resolved });
      this.save();
    }
    return this.list();
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

  read(id: string, relative: string): { path: string; text: string; missing?: boolean } {
    const root = this.root(id);
    const target = path.resolve(root, relative);
    if (!pathInside(root, target)) throw new Error("That file is outside the granted folder.");
    if (!this.exists(target)) return { path: path.relative(root, target), text: "", missing: true };
    const full = realpathSync.native(target);
    if (!pathInside(root, full)) throw new Error("That file is outside the granted folder.");
    if (!statSync(full).isFile() || statSync(full).size > MAX_FILE_BYTES) throw new Error("That file cannot be attached.");
    return { path: path.relative(root, full), text: readFileSync(full, "utf8") };
  }

  write(id: string, relative: string, text: string): { path: string; before: string | null } {
    const root = this.root(id);
    if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) throw new Error(`Shinbo writes at most ${MAX_FILE_BYTES} bytes to one file.`);
    const full = this.contain(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    let before: string | null = null;
    let destination = full;
    let mode = 0o600;
    try {
      const stats = statSync(full);
      if (!stats.isFile()) throw new Error("That path is not a file.");
      destination = realpathSync.native(full);
      mode = stats.mode & 0o777;
      if (stats.size <= MAX_FILE_BYTES) before = readFileSync(full, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
