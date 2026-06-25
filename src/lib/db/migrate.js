import { TABLES, buildCreateTableSql } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaWith, setMetaWith } from "./helpers/metaStore.js";
import { getAppVersion } from "./version.js";

// Track per-adapter so reusing the same adapter skips re-run.
const _migratedAdapters = new WeakSet();

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
async function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const current = parseInt(await getMetaWith(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    await adapter.transaction(async (tx) => {
      await m.up(tx);
      await setMetaWith(tx, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
async function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    await adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns. PostgreSQL stores unquoted identifiers lower-cased.
    const existing = await adapter.all(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ?`,
      [tableName.toLowerCase()]
    );
    const existingNames = new Set(existing.map((r) => r.column_name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName.toLowerCase())) {
        // Strip create-time-only qualifiers when adding a column to an
        // existing table (PRIMARY KEY / IDENTITY / UNIQUE).
        const safeDef = colDef
          .replace(/PRIMARY KEY/i, "")
          .replace(/GENERATED\s+(BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY/i, "")
          .replace(/AUTOINCREMENT/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          await adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { await adapter.exec(idx); } catch {}
    }
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // 1. Versioned migrations chain (skip-version safe)
  await runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  await syncSchemaFromTables(adapter);

  // 3. Stamp app version (best-effort; informational only)
  try {
    const oldVer = await getMetaWith(adapter, "appVersion", null);
    const newVer = getAppVersion();
    if (oldVer !== newVer) {
      await setMetaWith(adapter, "appVersion", newVer);
      if (oldVer) console.log(`[DB][migrate] App ${oldVer} → ${newVer}`);
    }
  } catch {}
}
