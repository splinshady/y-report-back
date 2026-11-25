import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { ScheduleActor, ScheduleDay, ScheduleRequestRecord, ScheduleStore } from "../db/schedule-types.js";
import { defaultTaxiPark } from "../db/taxi-park.js";
import { createScheduleRoute, scheduleRequestSchema, scheduleRequestsResponseSchema } from "./schedule.js";

function createMemoryStore() {
  const requests: ScheduleRequestRecord[] = [];
  const store: ScheduleStore = {
    async list() {
      return requests.map((request) => structuredClone(request));
    },
    async create(actor, days) {
      const taken = new Set(
        requests
          .filter((request) => request.status !== "rejected")
          .flatMap((request) => request.days.map((day) => day.date)),
      );
      if (days.some((day) => taken.has(day.date))) {
        return "conflict";
      }

      const request: ScheduleRequestRecord = {
        id: `request-${requests.length + 1}`,
        taxiParkId: defaultTaxiPark.id,
        status: "requested",
        createdBy: { id: actor.id, name: actor.name },
        approvedBy: null,
        rejectedBy: null,
        days: days.map((day) => ({ ...day })),
      };
      requests.push(request);
      return structuredClone(request);
    },
    async approve(actor, requestId) {
      const request = requests.find((item) => item.id === requestId);
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
    async reject(actor, requestId) {
      const request = requests.find((item) => item.id === requestId);
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
    async remove(requestId) {
      const index = requests.findIndex((item) => item.id === requestId);
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
    }),
  );
  return app;
}

function asUser(actor: ScheduleActor | null): HeadersInit {
  if (!actor) {
    return {};
  }

  return {
    "x-user-id": actor.id,
    "x-user-name": encodeURIComponent(actor.name),
  };
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
      taxiParkId: defaultTaxiPark.id,
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
});
