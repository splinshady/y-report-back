import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { ScheduleActor, ScheduleDay, ScheduleRequestRecord, ScheduleStore } from "../db/schedule-types.js";
import { createScheduleRoute, scheduleRequestSchema, scheduleRequestsResponseSchema } from "./schedule.js";

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

function createMemoryStore() {
  const requests: ScheduleRequestRecord[] = [];
  const store: ScheduleStore = {
    async list(taxiParkId) {
      return requests
        .filter((request) => request.taxiParkId === taxiParkId)
        .map((request) => structuredClone(request));
    },
    async create(taxiParkId, actor, days) {
      const taken = new Set(
        requests
          .filter((request) => request.taxiParkId === taxiParkId && request.status !== "rejected")
          .flatMap((request) => request.days.map((day) => day.date)),
      );
      if (days.some((day) => taken.has(day.date))) {
        return "conflict";
      }

      const request: ScheduleRequestRecord = {
        id: `request-${requests.length + 1}`,
        taxiParkId,
        status: "requested",
        createdBy: { id: actor.id, name: actor.name },
        approvedBy: null,
        rejectedBy: null,
        days: days.map((day) => ({ ...day })),
      };
      requests.push(request);
      return structuredClone(request);
    },
    async approve(taxiParkId, actor, requestId) {
      const request = requests.find((item) => item.id === requestId && item.taxiParkId === taxiParkId);
      if (!request) {
        return "missing";
      }
      if (request.status !== "requested") {
        return "none";
      }

      request.status = "approved";
      request.approvedBy = { id: actor.id, name: actor.name };
      return structuredClone(request);
    },
    async reject(taxiParkId, actor, requestId) {
      const request = requests.find((item) => item.id === requestId && item.taxiParkId === taxiParkId);
      if (!request) {
        return "missing";
      }
      if (request.status === "rejected") {
        return "none";
      }

      request.status = "rejected";
      request.rejectedBy = { id: actor.id, name: actor.name };
      return structuredClone(request);
    },
    async remove(taxiParkId, requestId) {
      const index = requests.findIndex((item) => item.id === requestId && item.taxiParkId === taxiParkId);
      if (index < 0) {
        return "missing";
      }

      requests.splice(index, 1);
      return "deleted";
    },
  };

  return store;
}

function createApp(store: ScheduleStore) {
  const app = new OpenAPIHono();
  app.route(
    "/api",
    createScheduleRoute({
      store,
      getSession: async (headers) => {
        const id = headers.get("x-user-id");
        const name = headers.get("x-user-name");
        if (!id || !name) {
          return null;
        }

        return { id, name: decodeURIComponent(name) };
      },
      getMembership: async (headers) => {
        const taxiParkId = headers.get("x-park-id");
        const role = headers.get("x-park-role");
        if (!taxiParkId || (role !== "owner" && role !== "worker")) {
          return null;
        }

        return { taxiParkId, role };
      },
    }),
  );
  return app;
}

const parkId = "park-1";

function asUser(actor: ScheduleActor | null, membership: ParkMembership | null = {
  taxiParkId: parkId,
  role: "owner",
}): HeadersInit {
  if (!actor) {
    return {};
  }

  const headers: Record<string, string> = {
    "x-user-id": actor.id,
    "x-user-name": encodeURIComponent(actor.name),
  };
  if (membership) {
    headers["x-park-id"] = membership.taxiParkId;
    headers["x-park-role"] = membership.role;
  }
  return headers;
}

const creator: ScheduleActor = { id: "user-anna", name: "Анна" };
const approver: ScheduleActor = { id: "user-boris", name: "Борис" };
const days: ScheduleDay[] = [
  { date: "2026-11-25", shift: "day" },
  { date: "2026-11-26", shift: "night" },
];

describe("schedule requests", () => {
  it("без сессии не читает и не пишет заявки", async () => {
    const app = createApp(createMemoryStore());

    const listed = await app.request("/api/schedule/requests");
    const created = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const approved = await app.request("/api/schedule/requests/request-1/approve", { method: "POST" });

    expect(listed.status).toBe(401);
    expect(created.status).toBe(401);
    expect(approved.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
  });

  it("сохраняет одну заявку на таксопарк и утверждает её другим пользователем", async () => {
    const app = createApp(createMemoryStore());

    const empty = await app.request("/api/schedule/requests", { headers: asUser(creator) });
    expect(empty.status).toBe(200);
    expect(scheduleRequestsResponseSchema.parse(await empty.json())).toEqual({ requests: [] });

    const created = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());
    expect(request).toMatchObject({
      taxiParkId: parkId,
      status: "requested",
      createdBy: creator,
      approvedBy: null,
      days,
    });

    const conflict = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(approver), "content-type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-11-25", shift: "night" }] }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "conflict" });

    const other = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-11-27", shift: "day" }] }),
    });
    const otherRequest = scheduleRequestSchema.parse(await other.json());

    const approved = await app.request(`/api/schedule/requests/${request.id}/approve`, {
      method: "POST",
      headers: asUser(approver),
    });
    expect(approved.status).toBe(200);
    expect(scheduleRequestSchema.parse(await approved.json())).toEqual({
      ...request,
      status: "approved",
      approvedBy: approver,
    });

    const listed = await app.request("/api/schedule/requests", { headers: asUser(creator) });
    const body = scheduleRequestsResponseSchema.parse(await listed.json());
    expect(body.requests.map((item) => item.status)).toEqual(["approved", "requested"]);
    expect(body.requests[1]?.id).toBe(otherRequest.id);

    const again = await app.request(`/api/schedule/requests/${request.id}/approve`, {
      method: "POST",
      headers: asUser(creator),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "none" });

    const unknown = await app.request("/api/schedule/requests/missing/approve", {
      method: "POST",
      headers: asUser(creator),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "missing" });

    const rejected = await app.request(`/api/schedule/requests/${otherRequest.id}/reject`, {
      method: "POST",
      headers: asUser(approver),
    });
    expect(rejected.status).toBe(200);
    expect(scheduleRequestSchema.parse(await rejected.json())).toMatchObject({
      id: otherRequest.id,
      status: "rejected",
      rejectedBy: approver,
    });

    const againDay = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-11-27", shift: "night" }] }),
    });
    expect(againDay.status).toBe(201);

    const removed = await app.request(`/api/schedule/requests/${otherRequest.id}`, {
      method: "DELETE",
      headers: asUser(creator),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
  });

  it("отклоняет пустой список, повтор дня и несуществующую дату", async () => {
    const app = createApp(createMemoryStore());
    const headers = { ...asUser(creator), "content-type": "application/json" };

    const empty = await app.request("/api/schedule/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ days: [] }),
    });
    const duplicate = await app.request("/api/schedule/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({
        days: [
          { date: "2026-11-25", shift: "day" },
          { date: "2026-11-25", shift: "night" },
        ],
      }),
    });
    const missing = await app.request("/api/schedule/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ days: [{ date: "2026-11-31", shift: "day" }] }),
    });

    expect(empty.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid" });
  });

  it("без членства не читает и не пишет заявки и не вызывает хранилище", async () => {
    const store = createMemoryStore();
    const calls = { list: 0, create: 0, approve: 0, reject: 0, remove: 0 };
    const watched: ScheduleStore = {
      list: async (taxiParkId) => {
        calls.list += 1;
        return store.list(taxiParkId);
      },
      create: async (taxiParkId, actor, requestDays) => {
        calls.create += 1;
        return store.create(taxiParkId, actor, requestDays);
      },
      approve: async (taxiParkId, actor, requestId) => {
        calls.approve += 1;
        return store.approve(taxiParkId, actor, requestId);
      },
      reject: async (taxiParkId, actor, requestId) => {
        calls.reject += 1;
        return store.reject(taxiParkId, actor, requestId);
      },
      remove: async (taxiParkId, requestId) => {
        calls.remove += 1;
        return store.remove(taxiParkId, requestId);
      },
    };
    const app = createApp(watched);
    const headers = asUser(creator, null);

    const listed = await app.request("/api/schedule/requests", { headers });
    const created = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const approved = await app.request("/api/schedule/requests/request-1/approve", {
      method: "POST",
      headers,
    });
    const rejected = await app.request("/api/schedule/requests/request-1/reject", {
      method: "POST",
      headers,
    });
    const removed = await app.request("/api/schedule/requests/request-1", {
      method: "DELETE",
      headers,
    });

    expect(listed.status).toBe(403);
    expect(created.status).toBe(403);
    expect(approved.status).toBe(403);
    expect(rejected.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(await listed.json()).toEqual({ error: "forbidden" });
    expect(calls).toEqual({ list: 0, create: 0, approve: 0, reject: 0, remove: 0 });
  });

  it("заявки разных таксопарков не смешиваются", async () => {
    const app = createApp(createMemoryStore());
    const firstPark = { taxiParkId: "park-a", role: "owner" as const };
    const secondPark = { taxiParkId: "park-b", role: "owner" as const };

    const created = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator, firstPark), "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());
    expect(request.taxiParkId).toBe(firstPark.taxiParkId);

    const listed = await app.request("/api/schedule/requests", { headers: asUser(approver, secondPark) });
    expect(scheduleRequestsResponseSchema.parse(await listed.json())).toEqual({ requests: [] });

    const sameDays = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(approver, secondPark), "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    expect(sameDays.status).toBe(201);
    expect(scheduleRequestSchema.parse(await sameDays.json()).taxiParkId).toBe(secondPark.taxiParkId);

    const approved = await app.request(`/api/schedule/requests/${request.id}/approve`, {
      method: "POST",
      headers: asUser(approver, secondPark),
    });
    const rejected = await app.request(`/api/schedule/requests/${request.id}/reject`, {
      method: "POST",
      headers: asUser(approver, secondPark),
    });
    const removed = await app.request(`/api/schedule/requests/${request.id}`, {
      method: "DELETE",
      headers: asUser(approver, secondPark),
    });

    expect(approved.status).toBe(404);
    expect(rejected.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(await approved.json()).toEqual({ error: "missing" });

    const own = await app.request("/api/schedule/requests", { headers: asUser(creator, firstPark) });
    expect(scheduleRequestsResponseSchema.parse(await own.json()).requests).toEqual([request]);
  });

  it("работник не утверждает заявку, отклонение и удаление остаются", async () => {
    const store = createMemoryStore();
    let approveCalls = 0;
    const watched: ScheduleStore = {
      ...store,
      approve: async (taxiParkId, actor, requestId) => {
        approveCalls += 1;
        return store.approve(taxiParkId, actor, requestId);
      },
    };
    const app = createApp(watched);
    const owner = { taxiParkId: parkId, role: "owner" as const };
    const worker = { taxiParkId: parkId, role: "worker" as const };

    const created = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator, worker), "content-type": "application/json" },
      body: JSON.stringify({ days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());

    const denied = await app.request(`/api/schedule/requests/${request.id}/approve`, {
      method: "POST",
      headers: asUser(creator, worker),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "forbidden" });
    expect(approveCalls).toBe(0);

    const stillRequested = await app.request("/api/schedule/requests", { headers: asUser(approver, owner) });
    expect(scheduleRequestsResponseSchema.parse(await stillRequested.json()).requests).toEqual([request]);

    const approved = await app.request(`/api/schedule/requests/${request.id}/approve`, {
      method: "POST",
      headers: asUser(approver, owner),
    });
    expect(approved.status).toBe(200);
    expect(scheduleRequestSchema.parse(await approved.json())).toEqual({
      ...request,
      status: "approved",
      approvedBy: approver,
    });
    expect(approveCalls).toBe(1);

    const other = await app.request("/api/schedule/requests", {
      method: "POST",
      headers: { ...asUser(creator, worker), "content-type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-11-27", shift: "day" }] }),
    });
    const otherRequest = scheduleRequestSchema.parse(await other.json());

    const rejected = await app.request(`/api/schedule/requests/${otherRequest.id}/reject`, {
      method: "POST",
      headers: asUser(creator, worker),
    });
    expect(rejected.status).toBe(200);
    expect(scheduleRequestSchema.parse(await rejected.json()).status).toBe("rejected");

    const removed = await app.request(`/api/schedule/requests/${otherRequest.id}`, {
      method: "DELETE",
      headers: asUser(creator, worker),
    });
    expect(removed.status).toBe(200);

    const listed = await app.request("/api/schedule/requests", { headers: asUser(approver, owner) });
    const body = scheduleRequestsResponseSchema.parse(await listed.json());
    expect(body.requests.map((item) => item.id)).toEqual([request.id]);
    expect(body.requests[0]?.status).toBe("approved");
  });
});
