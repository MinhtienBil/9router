// Ensure proxyFetch is loaded to patch globalThis.fetch.
import "open-sse/index.js";

import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getUsageForProvider } from "open-sse/services/usage.js";

const PROVIDER = "codex";
const DEFAULT_STATUS = 401;
const MAX_CONCURRENCY = 5;

async function checkConnection(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  return getUsageForProvider(connection, proxyOptions);
}

async function mapWithConcurrency(items, mapper, concurrency = MAX_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * GET /api/usage/unavailable-accounts
 *
 * Returns accounts whose live usage endpoint is unavailable with the requested
 * HTTP status. Defaults to active Codex accounts returning 401.
 *
 * Query params:
 *   status=401
 *   includeInactive=1
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedStatus = Number.parseInt(
      searchParams.get("status") || String(DEFAULT_STATUS),
      10,
    );
    const includeInactive = searchParams.get("includeInactive") === "1";

    if (!Number.isInteger(requestedStatus) || requestedStatus < 100 || requestedStatus > 599) {
      return Response.json({ error: "status must be a valid HTTP status code" }, { status: 400 });
    }

    const connections = (await getProviderConnections({ provider: PROVIDER })).filter(
      (connection) => includeInactive || (connection.isActive ?? true),
    );
    const checks = await mapWithConcurrency(connections, checkConnection);
    const emails = [];

    for (let index = 0; index < connections.length; index += 1) {
      const usage = checks[index];
      if (
        !usage?.error
        && usage?.unavailable === true
        && usage.status === requestedStatus
        && connections[index].email
      ) {
        emails.push(connections[index].email);
      }
    }

    if (emails.length === 0) {
      return Response.json(
        { error: "No matching Codex accounts found" },
        { status: 404 },
      );
    }

    return Response.json(emails);
  } catch (error) {
    console.warn(`[Unavailable accounts API] ${error.message}`);
    return Response.json({ error: "Failed to check unavailable accounts" }, { status: 500 });
  }
}
