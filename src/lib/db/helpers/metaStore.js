import { getAdapter } from "../driver.js";

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  const row = await db.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  await db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}

// Variants that run on a passed handle (adapter or transaction client) — used
// during migration before the singleton adapter is fully initialised.
export async function getMetaWith(handle, key, fallback = null) {
  const row = await handle.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export async function setMetaWith(handle, key, value) {
  await handle.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}
