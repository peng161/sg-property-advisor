import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

// SQLITE_DB_PATH env var is the authoritative source (set in .env.local).
// Falls back to cwd-relative paths to handle Turbopack workspace-root ambiguity.
export const LOCAL_DB_PATH = (() => {
  const candidates = [
    process.env.SQLITE_DB_PATH,
    path.join(process.cwd(), "data", "sg-property.db"),
    path.join(process.cwd(), "sg-property-advisor", "data", "sg-property.db"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
})();

let _client: Client | null = null;

export function getDb(): Client | null {
  if (_client) return _client;

  // Local file takes priority — lets dev work without pushing to Turso
  if (fs.existsSync(LOCAL_DB_PATH)) {
    _client = createClient({ url: `file:${LOCAL_DB_PATH}` });
    return _client;
  }

  // Fallback: Turso cloud (production / Vercel)
  // Accepts TURSO_URL or TURSO_DATABASE_URL (name used by Turso dashboard export)
  const tursoUrl   = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    _client = createClient({ url: tursoUrl, authToken: tursoToken });
    return _client;
  }

  return null;
}

export function isDbReady(): boolean {
  if (fs.existsSync(LOCAL_DB_PATH)) return true;
  const tursoUrl = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  return !!(tursoUrl && process.env.TURSO_AUTH_TOKEN);
}
