// Verify the PostgreSQL schema bootstraps correctly.
// Skipped automatically when DATABASE_URL is not configured (e.g. plain CI).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!(process.env.DATABASE_URL || process.env.PGHOST);

describe.skipIf(!HAS_DB)("PostgreSQL schema", () => {
  let db;

  beforeAll(async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    db = await getAdapter();
  });

  afterAll(async () => {
    try { await global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
  });

  it("stamps schemaVersion to the latest migration", async () => {
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const row = await db.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());
  });

  it("creates all declared tables", async () => {
    const rows = await db.all(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerconnections", "providernodes",
      "proxypools", "apikeys", "combos", "kv", "usagehistory", "usagedaily", "requestdetails",
    ]));
  });

  it("creates declared indexes", async () => {
    const rows = await db.all(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'providernodes'`
    );
    expect(rows.map((r) => r.indexname)).toContain("idx_pn_type");
  });

  it("round-trips a settings upsert", async () => {
    await db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ['{"foo":"bar"}']
    );
    const row = await db.get(`SELECT data FROM settings WHERE id = 1`);
    expect(JSON.parse(row.data)).toEqual({ foo: "bar" });
  });
});
