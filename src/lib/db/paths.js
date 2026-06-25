import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

// DATA_DIR still holds non-database artefacts (logs, MITM certs, DB export
// backups, etc.). The application data store itself now lives in PostgreSQL
// (configured via DATABASE_URL); there is no local SQLite file any more.
export const DB_DIR = path.join(DATA_DIR, "db");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");

export function ensureDirs() {
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
