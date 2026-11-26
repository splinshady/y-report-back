import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { TaxiParkMembership, TaxiParkRole, TaxiParkStore } from "../db/taxi-park-store.js";
import {
  createTaxiParkRoute,
  taxiParkInvitePath,
  taxiParkMembershipResponseSchema,
  taxiParkPath,
} from "./taxi-park.js";

type Member = {
  userId: string;
  taxiParkId: string;
  name: string;
  role: TaxiParkRole;
};

function createMemoryStore(knownUserIds: readonly string[]) {
  const users = new Set(knownUserIds);
  const members: Member[] = [];
  const calls = { read: 0, create: 0, invite: 0 };

  const store: TaxiParkStore = {
    async readMembership(userId) {
      calls.read += 1;
      const member = members.find((item) => item.userId === userId);
      if (!member) {
        return null;
      }

      return { taxiParkId: member.taxiParkId, name: member.name, role: member.role };
    },
    async createPark(userId, name) {
      calls.create += 1;
      if (members.some((item) => item.userId === userId)) {
        return "conflict";
      }

      const membership: TaxiParkMembership = {
        taxiParkId: `park-${members.length + 1}`,
        name,
        role: "owner",
      };
      members.push({ userId, ...membership });
      return membership;
    },
    async inviteWorker(actorUserId, workerUserId) {
      calls.invite += 1;
      const actor = members.find((item) => item.userId === actorUserId);
      if (!actor || actor.role !== "owner") {
        return "forbidden";
      }
      if (!users.has(workerUserId)) {
        return "missing";
      }
      if (members.some((item) => item.userId === workerUserId)) {
        return "conflict";
      }

      const membership: TaxiParkMembership = {
        taxiParkId: actor.taxiParkId,
        name: actor.name,
        role: "worker",
      };
      members.push({ userId: workerUserId, ...membership });
      return membership;
    },
  };

  return { store, members, calls };
}

function createApp(store: TaxiParkStore) {
  const app = new OpenAPIHono();
  app.route(
    "/api",
    createTaxiParkRoute({
      store,
      getSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) {
          return null;
        }

        return { id };
      },
    }),
  );
  return app;
}

function asUser(userId: string | null): HeadersInit {
  if (!userId) {
    return {};
  }

  return { "x-user-id": userId };
}

const ownerId = "user-owner";
const workerId = "user-worker";
const otherOwnerId = "user-other";

describe("taxi park", () => {
  it("без сессии не читает и не создаёт таксопарк", async () => {
    const memory = createMemoryStore([ownerId]);
    const app = createApp(memory.store);

    const read = await app.request(`/api${taxiParkPath}`);
    const created = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "North" }),
    });
    const invited = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: workerId }),
    });

    expect(read.status).toBe(401);
    expect(created.status).toBe(401);
    expect(invited.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
    expect(memory.calls).toEqual({ read: 0, create: 0, invite: 0 });
    expect(memory.members).toEqual([]);
  });

  it("без членства отвечает пустым членством", async () => {
    const memory = createMemoryStore([ownerId]);
    const app = createApp(memory.store);

    const read = await app.request(`/api${taxiParkPath}`, { headers: asUser(ownerId) });

    expect(read.status).toBe(200);
    expect(taxiParkMembershipResponseSchema.parse(await read.json())).toEqual({ membership: null });
  });

  it("пустое название не создаёт таксопарк", async () => {
    const memory = createMemoryStore([ownerId]);
    const app = createApp(memory.store);
    const headers = { ...asUser(ownerId), "content-type": "application/json" };

    const empty = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "   " }),
    });
    const missing = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid" });
    expect(memory.calls.create).toBe(0);
    expect(memory.members).toEqual([]);
  });

  it("создатель становится владельцем и не создаёт второй таксопарк", async () => {
    const memory = createMemoryStore([ownerId, workerId, otherOwnerId]);
    const app = createApp(memory.store);
    const headers = { ...asUser(ownerId), "content-type": "application/json" };

    const created = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "  North  " }),
    });
    expect(created.status).toBe(201);
    const membership = taxiParkMembershipResponseSchema.parse(await created.json());
    expect(membership).toEqual({
      membership: {
        taxiParkId: "park-1",
        name: "North",
        role: "owner",
      },
    });

    const again = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "South" }),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict" });
    expect(memory.members).toHaveLength(1);
    expect(memory.members[0]?.role).toBe("owner");

    const read = await app.request(`/api${taxiParkPath}`, { headers: asUser(ownerId) });
    expect(taxiParkMembershipResponseSchema.parse(await read.json())).toEqual(membership);
  });

  it("владелец приглашает работника, неизвестный и занятый id работника не создают", async () => {
    const memory = createMemoryStore([ownerId, workerId, otherOwnerId]);
    const app = createApp(memory.store);

    const created = await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers: { ...asUser(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ name: "North" }),
    });
    const ownerMembership = taxiParkMembershipResponseSchema.parse(await created.json()).membership;

    const unknown = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { ...asUser(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ userId: "missing-user" }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "missing" });
    expect(memory.members).toHaveLength(1);

    const self = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { ...asUser(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ userId: ownerId }),
    });
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: "conflict" });
    expect(memory.members).toEqual([
      { userId: ownerId, taxiParkId: ownerMembership?.taxiParkId, name: "North", role: "owner" },
    ]);

    const invited = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { ...asUser(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ userId: workerId }),
    });
    expect(invited.status).toBe(201);
    expect(taxiParkMembershipResponseSchema.parse(await invited.json())).toEqual({
      membership: {
        taxiParkId: ownerMembership?.taxiParkId,
        name: "North",
        role: "worker",
      },
    });

    const workerRead = await app.request(`/api${taxiParkPath}`, { headers: asUser(workerId) });
    expect(taxiParkMembershipResponseSchema.parse(await workerRead.json()).membership?.role).toBe("worker");

    const workerInvite = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { ...asUser(workerId), "content-type": "application/json" },
      body: JSON.stringify({ userId: otherOwnerId }),
    });
    expect(workerInvite.status).toBe(403);
    expect(await workerInvite.json()).toEqual({ error: "forbidden" });
    expect(memory.members.some((member) => member.userId === otherOwnerId)).toBe(false);

    await app.request(`/api${taxiParkPath}`, {
      method: "POST",
      headers: { ...asUser(otherOwnerId), "content-type": "application/json" },
      body: JSON.stringify({ name: "South" }),
    });
    const taken = await app.request(`/api${taxiParkInvitePath}`, {
      method: "POST",
      headers: { ...asUser(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ userId: otherOwnerId }),
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "conflict" });

    const other = memory.members.find((member) => member.userId === otherOwnerId);
    expect(other).toMatchObject({ role: "owner", name: "South" });
    expect(memory.members.filter((member) => member.userId === otherOwnerId)).toHaveLength(1);
  });
});
