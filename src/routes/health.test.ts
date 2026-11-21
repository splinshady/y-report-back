import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => {
  class Pool {
    constructor() {
      throw new Error("Database connection should not be opened");
    }
  }

  return { Pool, default: { Pool } };
});

vi.mock("better-auth", () => ({
  betterAuth: () => {
    throw new Error("Auth should not be initialized");
  },
}));

const { app } = await import("../app.js");
const { healthResponseSchema } = await import("./health.js");

describe("GET /api/health", () => {
  it("возвращает ok: true без PostgreSQL", async () => {
    const response = await app.request("/api/health");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(healthResponseSchema.parse(body)).toEqual({ ok: true });
  });
});
