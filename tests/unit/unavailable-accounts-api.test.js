import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getUsageForProvider: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));

vi.mock("open-sse/index.js", () => ({}));

describe("GET /api/usage/unavailable-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("returns only active Codex accounts whose usage API returns 401", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "bad", provider: "codex", email: "bad@example.com", accessToken: "secret-a", isActive: true },
      { id: "good", provider: "codex", email: "good@example.com", accessToken: "secret-b", isActive: true },
      { id: "off", provider: "codex", email: "off@example.com", accessToken: "secret-c", isActive: false },
    ]);
    mocks.getUsageForProvider
      .mockResolvedValueOnce({ unavailable: true, status: 401, message: "Usage API temporarily unavailable (401)." })
      .mockResolvedValueOnce({ plan: "plus", quotas: {} });

    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
    expect(mocks.getUsageForProvider).toHaveBeenCalledTimes(2);
    expect(body).toEqual(["bad@example.com"]);
    expect(JSON.stringify(body)).not.toContain("secret-a");
  });

  it("validates the requested HTTP status", async () => {
    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts?status=nope"));

    expect(response.status).toBe(400);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("returns an error and always checks Codex when no account matches", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts?provider=claude"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No matching Codex accounts found" });
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
  });
});
