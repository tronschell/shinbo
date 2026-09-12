





export function reasonText(reason: unknown): string {
  const raw = (reason instanceof Error ? reason.message : String(reason)).trim();


  return raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "").trim() || "Something went wrong.";
}
