import pg from "pg";
import { COLUMN_CASE_MAP } from "../schema.js";

const { Pool, types } = pg;

// Return BIGINT / COUNT(*) (OID 20) as JS numbers instead of strings so that
// `cnt.c > maxRecords`, `before.n`, etc. keep working like under SQLite.
// Counts in this app are always small (well within Number.MAX_SAFE_INTEGER).
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, ...`.
// Quote-aware: `?` inside single-quoted string literals is left untouched.
function toPgPlaceholders(sql) {
  if (!sql.includes("?")) return sql;
  let out = "";
  let i = 0;
  let n = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
    } else if (ch === "?" && !inString) {
      out += `$${++n}`;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

// PostgreSQL lower-cases unquoted identifiers; remap row keys back to the
// camelCase column names the repos expect (e.g. authtype -> authType).
function remapRow(row) {
  if (!row) return row;
  let needs = false;
  for (const k in row) {
    if (COLUMN_CASE_MAP[k]) { needs = true; break; }
  }
  if (!needs) return row;
  const out = {};
  for (const k in row) {
    out[COLUMN_CASE_MAP[k] || k] = row[k];
  }
  return out;
}

// Build the { run, get, all, exec, transaction } handle bound to a given
// executor (the pool, or a dedicated client inside a transaction).
function makeHandle(executor, { allowTransaction = true } = {}) {
  const handle = {
    async run(sql, params = []) {
      const res = await executor.query(toPgPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0, rows: res.rows };
    },
    async get(sql, params = []) {
      const res = await executor.query(toPgPlaceholders(sql), params);
      return res.rows.length ? remapRow(res.rows[0]) : undefined;
    },
    async all(sql, params = []) {
      const res = await executor.query(toPgPlaceholders(sql), params);
      return res.rows.map(remapRow);
    },
    async exec(sql) {
      // DDL / multi-statement, no params.
      await executor.query(sql);
    },
  };

  if (allowTransaction) {
    handle.transaction = async (fn) => fn(handle);
  }

  return handle;
}

export async function createPostgresAdapter() {
  const connectionString = process.env.DATABASE_URL || undefined;
  if (!connectionString && !process.env.PGHOST && !process.env.PGUSER) {
    throw new Error("[DB] DATABASE_URL is not set (PostgreSQL connection required)");
  }

  const sslRequested =
    process.env.DATABASE_SSL === "true" ||
    /[?&]sslmode=(require|verify-ca|verify-full)/.test(connectionString || "");
  const ssl = sslRequested
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" }
    : undefined;

  const pool = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on("error", (err) => {
    console.error("[DB] idle PostgreSQL client error:", err.message);
  });

  // Verify connectivity early so getAdapter() fails fast with a clear message.
  const probe = await pool.connect();
  probe.release();

  const base = makeHandle(pool, { allowTransaction: false });

  return {
    driver: "postgres",
    run: base.run,
    get: base.get,
    all: base.all,
    exec: base.exec,
    // All queries inside fn run on a single dedicated client wrapped in
    // BEGIN/COMMIT. fn receives a transactional handle and MUST be async.
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = makeHandle(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    },
    async checkpoint() {},
    async close() {
      await pool.end();
    },
    raw: pool,
  };
}
