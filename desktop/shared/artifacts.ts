







export const ARTIFACT_KINDS = ["markdown", "code", "html", "app", "svg", "mermaid", "react"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];


export const ARTIFACT_EXTENSIONS: Record<ArtifactKind, string> = {
  markdown: "md",
  code: "txt",
  html: "html",
  app: "html",
  svg: "svg",
  mermaid: "mmd",
  react: "jsx",
};

export const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
  markdown: "Document",
  code: "Code",
  html: "Web page",
  app: "App",
  svg: "Drawing",
  mermaid: "Diagram",
  react: "React component",
};














export const ARTIFACT_SURFACES = ["navbar", "chat", "notch", "context"] as const;
export type ArtifactSurface = (typeof ARTIFACT_SURFACES)[number];

export const SURFACE_LABELS: Record<ArtifactSurface, string> = {
  navbar: "Sidebar",
  chat: "Thread",
  notch: "Notch",
  context: "Context bar",
};

export function isArtifactSurface(value: unknown): value is ArtifactSurface {
  return typeof value === "string" && (ARTIFACT_SURFACES as readonly string[]).includes(value);
}






export const mountable = (kind: ArtifactKind) => kind === "code";










export const artifactModuleUrl = (id: string, version: number) => `${ARTIFACT_SCHEME}://${id}/module.js?v=${version}`;
export const MODULE_PATH = "module.js";









export const MAX_ARTIFACT_BYTES = 512 * 1024;

export const MAX_ARTIFACTS = 512;
export const MAX_ARTIFACT_TITLE_CHARS = 200;






export const ARTIFACT_DB_FILE = "data.sqlite";





export const MAX_ARTIFACT_DB_BYTES = 16 * 1024 * 1024;
export const MAX_ARTIFACT_SQL_CHARS = 8 * 1024;
export const MAX_ARTIFACT_SQL_PARAMS = 64;

export const MAX_ARTIFACT_ROWS = 2000;

export const MAX_ARTIFACT_FILES = 16;






export const ARTIFACT_FILE_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};









export function validArtifactFile(value: unknown): value is string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}\.[a-z0-9]{1,8}$/.test(value)) return false;
  if (value === ARTIFACT_DB_FILE || value === "meta.json" || value.startsWith("content.")) return false;
  return Object.hasOwn(ARTIFACT_FILE_TYPES, value.slice(value.indexOf(".") + 1));
}

export const artifactFileType = (file: string) => ARTIFACT_FILE_TYPES[file.slice(file.indexOf(".") + 1)] ?? "text/plain; charset=utf-8";

export interface ArtifactMeta {
  id: string;
  title: string;
  kind: ArtifactKind;

  language: string;
  createdAt: string;
  updatedAt: string;

  version: number;

  surface?: ArtifactSurface;

  sourceThreadId?: string;

  sourceJobId?: string;
}

export interface Artifact extends ArtifactMeta {
  content: string;
  path: string;
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}






export function artifactSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "artifact";
}


export function validArtifactId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}























export const artifactMarker = (id: string) => `[artifact:${id}]`;






export const ARTIFACT_MARKER = /^\[artifact:([a-z0-9-]+)]/;









export function artifactWritten(step: { status: string; output?: string }): string | undefined {
  if (step.status !== "completed") return undefined;
  return ARTIFACT_MARKER.exec((step.output ?? "").trimStart())?.[1];
}

export const ARTIFACT_SCHEME = "shinbo-artifact";

export const artifactFrameUrl = (id: string, version: number) => `${ARTIFACT_SCHEME}://${id}/?v=${version}`;
