import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

const LOCAL_DB_PATH = path.join(process.cwd(), "data", "sg-property.db");

let _client: Client | null = null;

export function getDb(): Client | null {
  if (_client) return _client;

  if (process.env.TURSO_URL) {
    _client = createClient({
      url:       process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });
    return _client;
  }

  if (fs.existsSync(LOCAL_DB_PATH)) {
    _client = createClient({ url: `file:${LOCAL_DB_PATH}` });
    return _client;
  }

  return null;
}

// Synchronous check — just tests whether credentials / local file are present.
// Actual data presence is validated lazily when queries run.
export function isDbReady(): boolean {
  if (process.env.TURSO_URL) return true;
  return fs.existsSync(LOCAL_DB_PATH);
}
