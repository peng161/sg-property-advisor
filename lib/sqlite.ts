import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

export const DB_PATH = path.join(process.cwd(), "data", "sg-property.db");

// Singleton read-only connection for the Next.js app runtime
let _db: Database.Database | null = null;

export function getDb(): Database.Database | null {
  if (!fs.existsSync(DB_PATH)) return null;
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

export function isDbReady(): boolean {
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    const db = getDb();
    if (!db) return false;
    const row = db.prepare("SELECT COUNT(*) as n FROM private_project").get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}
