// Use the HTTP-only libsql client for Turso connections — no native binary needed.
// The full @libsql/client (which loads native SQLite) is only required locally for
// file-based dev databases. On Vercel/serverless, this import is never reached.
import { createClient as createHttpClient, type Client } from "@libsql/client/http";
import path from "path";
import fs from "fs";

export const LOCAL_DB_PATH = (() => {
  const candidates = [
    process.env.SQLITE_DB_PATH,
    path.join(process.cwd(), "data", "sg-property.db"),
    path.join(process.cwd(), "sg-property-advisor", "data", "sg-property.db"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
})();

let _client: Client | null = null;
let _initError: string | null = null;

export function getDbError(): string | null { return _initError; }

export function getDb(): Client | null {
  if (_client) return _client;

  // Local SQLite file — only used in local dev (never on Vercel).
  // Lazy-require the full client so the native binary is never loaded on Vercel.
  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require("@libsql/client") as { createClient: typeof createHttpClient };
      _client = createClient({ url: `file:${LOCAL_DB_PATH}` });
      _initError = null;
      return _client;
    } catch (e) {
      _initError = e instanceof Error ? e.message : String(e);
      // fall through to Turso
    }
  }

  // Turso cloud — pure HTTP, no native deps.
  const tursoUrl   = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    try {
      _client = createHttpClient({ url: tursoUrl, authToken: tursoToken });
      _initError = null;
      return _client;
    } catch (e) {
      _initError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  return null;
}

export function isDbReady(): boolean {
  if (fs.existsSync(LOCAL_DB_PATH)) return true;
  const tursoUrl = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  return !!(tursoUrl && process.env.TURSO_AUTH_TOKEN);
}
