#!/usr/bin/env node

// Postinstall: warm-up the tray runtime. The application data store is now
// PostgreSQL (configured via DATABASE_URL), so there are no native SQLite
// runtime deps to install here any more.
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

process.exit(0);
