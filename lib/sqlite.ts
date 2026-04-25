import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

export const LOCAL_DB_PATH = path.join(process.cwd(), "data", "sg-property.db");

let _client: Client | null = null;

export function getDb(): Client | null {
  if (_client) return _client;

  // Local file takes priority — lets dev work without pushing to Turso
  if (fs.existsSync(LOCAL_DB_PATH)) {
    _client = createClient({ url: `file:${LOCAL_DB_PATH}` });
    return _client;
  }

  // Fallback: Turso cloud (production / Vercel)
  if (process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN) {
    _client = createClient({
      url:       process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return _client;
  }

  return null;
}

export function isDbReady(): boolean {
  if (fs.existsSync(LOCAL_DB_PATH)) return true;
  return !!(process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN);
}
