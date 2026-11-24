import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const betterAuth = vi.hoisted(() => vi.fn());

vi.mock("pg", () => {
  class Pool {
    constructor() {
      throw new Error("Database connection should not be opened");
    }
  }

  return { Pool, default: { Pool } };
});

vi.mock("../db/client.js", () => ({
  createDb: () => ({ mocked: true }),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({ kind: "drizzle" }),
}));

vi.mock("better-auth", () => ({
  betterAuth: (...args: unknown[]) => betterAuth(...args),
}));

const { createAuth, mountAuth } = await import("./index.js");

describe("createAuth", () => {
  const previousClientId = process.env.YANDEX_CLIENT_ID;
  const previousClientSecret = process.env.YANDEX_CLIENT_SECRET;

  afterEach(() => {
    if (previousClientId === undefined) {
      delete process.env.YANDEX_CLIENT_ID;
    } else {
      process.env.YANDEX_CLIENT_ID = previousClientId;
    }

    if (previousClientSecret === undefined) {
      delete process.env.YANDEX_CLIENT_SECRET;
    } else {
      process.env.YANDEX_CLIENT_SECRET = previousClientSecret;
    }

    betterAuth.mockReset();
  });

  it("передаёт только yandex из окружения и отдаёт обработчик на /api/auth", async () => {
    process.env.YANDEX_CLIENT_ID = "env-client-id";
    process.env.YANDEX_CLIENT_SECRET = "env-client-secret";

    const handler = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname.startsWith("/api/auth")).toBe(true);
      return new Response(null, { status: 204 });
    });
    betterAuth.mockReturnValue({ handler });

    const auth = createAuth("test-secret");

    expect(betterAuth).toHaveBeenCalledTimes(1);

    const options = betterAuth.mock.calls[0]?.[0] as {
      secret: string;
      baseURL?: string;
      emailAndPassword?: unknown;
      socialProviders?: unknown;
      plugins: Array<{
        id: string;
        options: {
          config: Array<{
            providerId: string;
            clientId: string;
            clientSecret?: string;
          }>;
        };
      }>;
    };

    expect(options.secret).toBe("test-secret");
    expect(options.baseURL).toBe("http://127.0.0.1:5173");
    expect(options.emailAndPassword).toBeUndefined();
    expect(options.socialProviders).toBeUndefined();
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins[0]?.id).toBe("generic-oauth");

    const providers = options.plugins[0]?.options.config ?? [];
    expect(providers.map((provider) => provider.providerId)).toEqual(["yandex"]);
    expect(providers[0]).toMatchObject({
      providerId: "yandex",
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
    });

    const app = new Hono();
    mountAuth(app, auth);

    const response = await app.request("http://127.0.0.1/api/auth/get-session");
    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledTimes(1);

    const outside = await app.request("http://127.0.0.1/api/health");
    expect(outside.status).toBe(404);
  });
});
