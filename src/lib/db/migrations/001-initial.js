// Initial schema bootstrap. For a fresh DB this creates all tables/indexes.
// Idempotent (IF NOT EXISTS) so it is safe to (re)run on an existing DB.
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 1,
  name: "initial",
  async up(db) {
    for (const [name, def] of Object.entries(TABLES)) {
      await db.exec(buildCreateTableSql(name, def));
      for (const idx of def.indexes || []) await db.exec(idx);
    }
  },
};
