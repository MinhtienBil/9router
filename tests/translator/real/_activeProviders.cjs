// Synchronously read the DISTINCT active providers from PostgreSQL so vitest can
// generate one test per provider at collection time (mirrors the old synchronous
// SQLite read). Spawns a short-lived child `node` process that uses `pg`, since
// the pg client itself is async. Tolerant of any failure (returns []).
const { execFileSync } = require("child_process");

function readActiveProviders() {
  const script =
    "const pg=require('pg');" +
    "(async()=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});" +
    "try{const r=await p.query(\"SELECT DISTINCT provider FROM providerConnections WHERE isActive = 1\");" +
    "process.stdout.write(JSON.stringify(r.rows.map(x=>x.provider)));}" +
    "catch(e){process.stdout.write('[]');}finally{await p.end();}})();";
  try {
    const out = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const list = JSON.parse(out || "[]");
    return Array.isArray(list) ? list.sort() : [];
  } catch {
    return [];
  }
}

module.exports = { readActiveProviders };
