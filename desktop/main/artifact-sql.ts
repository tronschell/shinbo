import { constants, DatabaseSync } from "node:sqlite";
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_DB_BYTES, MAX_ARTIFACT_ROWS } from "../shared/artifacts";

const guardedPragmas = new Set(["hard_heap_limit", "soft_heap_limit", "max_page_count", "page_size", "journal_mode", "synchronous", "writable_schema", "temp_store", "temp_store_directory", "data_store_directory"]);

process.once("message", (request: { file: string; sql: string; params: (null | number | string)[] }) => {
  try {
    process.send?.({ rows: query(request) });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    process.disconnect();
  }
});

function query({ file, sql, params }: { file: string; sql: string; params: (null | number | string)[] }): Record<string, unknown>[] {
  const database = new DatabaseSync(file, { timeout: 1000 });
  try {
    database.exec("pragma hard_heap_limit = 67108864; pragma temp_store = memory");
    const pageSize = Number((database.prepare("pragma page_size").get() as { page_size?: number } | undefined)?.page_size) || 4096;
    database.prepare(`pragma max_page_count = ${Math.floor(MAX_ARTIFACT_DB_BYTES / pageSize)}`).run();
    database.setAuthorizer((action, first, second) => action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH || (action === constants.SQLITE_PRAGMA && second !== null && guardedPragmas.has(first?.toLowerCase() ?? "")) ? constants.SQLITE_DENY : constants.SQLITE_OK);
    const rows: Record<string, unknown>[] = [];
    let bytes = 0;
    for (const row of database.prepare(sql).iterate(...params)) {
      if (rows.length >= MAX_ARTIFACT_ROWS) throw new Error(`That returned more than ${MAX_ARTIFACT_ROWS} rows. Add a LIMIT, or count in SQL rather than in the page.`);
      for (const [key, value] of Object.entries(row)) {
        bytes += Buffer.byteLength(key) + (typeof value === "string" ? Buffer.byteLength(value) : ArrayBuffer.isView(value) ? value.byteLength : 8);
      }
      if (bytes > MAX_ARTIFACT_BYTES * 8) throw new Error("That query returned too much data. Select fewer or smaller values.");
      rows.push({ ...row });
    }
    return rows;
  } finally {
    database.close();
  }
}
