import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { ScheduleActor, ScheduleDay, ScheduleRequestRecord, ScheduleStore } from "../db/schedule-types.js";
import {
  createScheduleRoute,
  scheduleRequestApprovePath,
  scheduleRequestDeletePath,
  scheduleRequestRejectPath,
  scheduleRequestSchema,
  scheduleRequestsPath,
  scheduleRequestsResponseSchema,
} from "./schedule.js";

const carId = "car-1";
const secondCarId = "car-2";

const knownCars = [
  { id: carId, taxiParkId: "park-1" },
  { id: secondCarId, taxiParkId: "park-1" },
  { id: "car-a", taxiParkId: "park-a" },
  { id: "car-b", taxiParkId: "park-b" },
];

function apiPath(path: string, id?: string) {
  const resolved = id ? path.replaceAll("{id}", encodeURIComponent(id)) : path;
  return `/api${resolved}`;
}

function requestsUrl(id = carId) {
  return `${apiPath(scheduleRequestsPath)}?carId=${encodeURIComponent(id)}`;
}

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

function createMemoryStore() {
  const requests: ScheduleRequestRecord[] = [];
  const store: ScheduleStore = {
    async list(taxiParkId, requestCarId) {
      return requests
        .filter((request) => request.taxiParkId === taxiParkId && request.carId === requestCarId)
        .map((request) => structuredClone(request));
    },
    async create(taxiParkId, requestCarId, actor, days) {
      const taken = new Set(
        requests
          .filter((request) => request.carId === requestCarId && request.status !== "rejected")
          .flatMap((request) => request.days.map((day) => day.date)),
      );
      if (days.some((day) => taken.has(day.date))) {
        return "conflict";
      }

      const request: ScheduleRequestRecord = {
        id: `request-${requests.length + 1}`,
        taxiParkId,
        carId: requestCarId,
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

function createApp(store: ScheduleStore, hooks?: { onFindCar?: () => void }) {
  const app = new OpenAPIHono();
  app.route(
    "/api",
    createScheduleRoute({
      store,
      findCar: async (taxiParkId, requestCarId) => {
        hooks?.onFindCar?.();
        const found = knownCars.find((item) => item.id === requestCarId && item.taxiParkId === taxiParkId);
        return found ? { id: found.id } : null;
      },
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

    const listed = await app.request(requestsUrl());
    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ carId, days }),
    });
    const approved = await app.request(apiPath(scheduleRequestApprovePath, "request-1"), { method: "POST" });

    expect(listed.status).toBe(401);
    expect(created.status).toBe(401);
    expect(approved.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
  });

  it("сохраняет заявку на машину и утверждает её другим пользователем", async () => {
    const app = createApp(createMemoryStore());

    const empty = await app.request(requestsUrl(), { headers: asUser(creator) });
    expect(empty.status).toBe(200);
    expect(scheduleRequestsResponseSchema.parse(await empty.json())).toEqual({ requests: [] });

    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ carId, days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());
    expect(request).toMatchObject({
      taxiParkId: parkId,
      carId,
      status: "requested",
      createdBy: creator,
      approvedBy: null,
      days,
    });

    const conflict = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(approver), "content-type": "application/json" },
      body: JSON.stringify({ carId, days: [{ date: "2026-11-25", shift: "night" }] }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "conflict" });

    const other = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ carId, days: [{ date: "2026-11-27", shift: "day" }] }),
    });
    const otherRequest = scheduleRequestSchema.parse(await other.json());

    const approved = await app.request(apiPath(scheduleRequestApprovePath, request.id), {
      method: "POST",
      headers: asUser(approver),
    });
    expect(approved.status).toBe(200);
    expect(scheduleRequestSchema.parse(await approved.json())).toEqual({
      ...request,
      status: "approved",
      approvedBy: approver,
    });

    const listed = await app.request(requestsUrl(), { headers: asUser(creator) });
    const body = scheduleRequestsResponseSchema.parse(await listed.json());
    expect(body.requests.map((item) => item.status)).toEqual(["approved", "requested"]);
    expect(body.requests[1]?.id).toBe(otherRequest.id);

    const again = await app.request(apiPath(scheduleRequestApprovePath, request.id), {
      method: "POST",
      headers: asUser(creator),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "none" });

    const unknown = await app.request(apiPath(scheduleRequestApprovePath, "missing"), {
      method: "POST",
      headers: asUser(creator),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "missing" });

    const rejected = await app.request(apiPath(scheduleRequestRejectPath, otherRequest.id), {
      method: "POST",
      headers: asUser(approver),
    });
    expect(rejected.status).toBe(200);
    expect(scheduleRequestSchema.parse(await rejected.json())).toMatchObject({
      id: otherRequest.id,
      status: "rejected",
      rejectedBy: approver,
    });

    const againDay = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ carId, days: [{ date: "2026-11-27", shift: "night" }] }),
    });
    expect(againDay.status).toBe(201);

    const removed = await app.request(apiPath(scheduleRequestDeletePath, otherRequest.id), {
      method: "DELETE",
      headers: asUser(creator),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
  });

  it("отклоняет пустой список, повтор дня, несуществующую дату и пустую машину", async () => {
    const store = createMemoryStore();
    let findCarCalls = 0;
    const app = createApp(store, {
      onFindCar: () => {
        findCarCalls += 1;
      },
    });
    const headers = { ...asUser(creator), "content-type": "application/json" };

    const empty = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ carId, days: [] }),
    });
    const duplicate = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({
        carId,
        days: [
          { date: "2026-11-25", shift: "day" },
          { date: "2026-11-25", shift: "night" },
        ],
      }),
    });
    const missing = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ carId, days: [{ date: "2026-11-31", shift: "day" }] }),
    });
    const missingCar = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ days }),
    });
    const missingQuery = await app.request(apiPath(scheduleRequestsPath), { headers: asUser(creator) });

    expect(empty.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(missingCar.status).toBe(400);
    expect(missingQuery.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid" });
    expect(findCarCalls).toBe(0);
    expect(await store.list(parkId, carId)).toEqual([]);
  });

  it("без членства не читает и не пишет заявки и не вызывает хранилище", async () => {
    const store = createMemoryStore();
    const calls = { list: 0, create: 0, approve: 0, reject: 0, remove: 0, findCar: 0 };
    const watched: ScheduleStore = {
      list: async (taxiParkId, requestCarId) => {
        calls.list += 1;
        return store.list(taxiParkId, requestCarId);
      },
      create: async (taxiParkId, requestCarId, actor, requestDays) => {
        calls.create += 1;
        return store.create(taxiParkId, requestCarId, actor, requestDays);
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
    const app = createApp(watched, {
      onFindCar: () => {
        calls.findCar += 1;
      },
    });
    const headers = asUser(creator, null);

    const listed = await app.request(requestsUrl(), { headers });
    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ carId, days }),
    });
    const approved = await app.request(apiPath(scheduleRequestApprovePath, "request-1"), {
      method: "POST",
      headers,
    });
    const rejected = await app.request(apiPath(scheduleRequestRejectPath, "request-1"), {
      method: "POST",
      headers,
    });
    const removed = await app.request(apiPath(scheduleRequestDeletePath, "request-1"), {
      method: "DELETE",
      headers,
    });

    expect(listed.status).toBe(403);
    expect(created.status).toBe(403);
    expect(approved.status).toBe(403);
    expect(rejected.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(await listed.json()).toEqual({ error: "forbidden" });
    expect(calls).toEqual({ list: 0, create: 0, approve: 0, reject: 0, remove: 0, findCar: 0 });
  });

  it("заявки разных таксопарков не смешиваются", async () => {
    const app = createApp(createMemoryStore());
    const firstPark = { taxiParkId: "park-a", role: "owner" as const };
    const secondPark = { taxiParkId: "park-b", role: "owner" as const };

    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator, firstPark), "content-type": "application/json" },
      body: JSON.stringify({ carId: "car-a", days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());
    expect(request.taxiParkId).toBe(firstPark.taxiParkId);
    expect(request.carId).toBe("car-a");

    const listed = await app.request(requestsUrl("car-b"), { headers: asUser(approver, secondPark) });
    expect(scheduleRequestsResponseSchema.parse(await listed.json())).toEqual({ requests: [] });

    const sameDays = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(approver, secondPark), "content-type": "application/json" },
      body: JSON.stringify({ carId: "car-b", days }),
    });
    expect(sameDays.status).toBe(201);
    expect(scheduleRequestSchema.parse(await sameDays.json()).taxiParkId).toBe(secondPark.taxiParkId);

    const approved = await app.request(apiPath(scheduleRequestApprovePath, request.id), {
      method: "POST",
      headers: asUser(approver, secondPark),
    });
    const rejected = await app.request(apiPath(scheduleRequestRejectPath, request.id), {
      method: "POST",
      headers: asUser(approver, secondPark),
    });
    const removed = await app.request(apiPath(scheduleRequestDeletePath, request.id), {
      method: "DELETE",
      headers: asUser(approver, secondPark),
    });

    expect(approved.status).toBe(404);
    expect(rejected.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(await approved.json()).toEqual({ error: "missing" });

    const own = await app.request(requestsUrl("car-a"), { headers: asUser(creator, firstPark) });
    expect(scheduleRequestsResponseSchema.parse(await own.json()).requests).toEqual([request]);
  });

  it("тот же день другой машины свободен, чужая машина не создаёт заявку", async () => {
    const store = createMemoryStore();
    const calls = { list: 0, create: 0 };
    const watched: ScheduleStore = {
      ...store,
      list: async (taxiParkId, requestCarId) => {
        calls.list += 1;
        return store.list(taxiParkId, requestCarId);
      },
      create: async (taxiParkId, requestCarId, actor, requestDays) => {
        calls.create += 1;
        return store.create(taxiParkId, requestCarId, actor, requestDays);
      },
    };
    const app = createApp(watched);

    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ carId, days }),
    });
    const first = scheduleRequestSchema.parse(await created.json());

    const otherCar = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(approver), "content-type": "application/json" },
      body: JSON.stringify({ carId: secondCarId, days }),
    });
    expect(otherCar.status).toBe(201);
    const second = scheduleRequestSchema.parse(await otherCar.json());
    expect(second.carId).toBe(secondCarId);

    const listedFirst = scheduleRequestsResponseSchema.parse(
      await (await app.request(requestsUrl(carId), { headers: asUser(creator) })).json(),
    );
    const listedSecond = scheduleRequestsResponseSchema.parse(
      await (await app.request(requestsUrl(secondCarId), { headers: asUser(creator) })).json(),
    );
    expect(listedFirst.requests).toEqual([first]);
    expect(listedSecond.requests).toEqual([second]);

    const callsBeforeMiss = { ...calls };
    const unknown = await app.request(requestsUrl("missing-car"), { headers: asUser(creator) });
    const foreign = await app.request(requestsUrl("car-b"), { headers: asUser(creator) });
    const foreignCreate = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator), "content-type": "application/json" },
      body: JSON.stringify({ carId: "car-b", days: [{ date: "2026-12-01", shift: "day" }] }),
    });

    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreignCreate.status).toBe(404);
    expect(await foreignCreate.json()).toEqual({ error: "missing" });
    expect(calls).toEqual(callsBeforeMiss);

    const approved = await app.request(apiPath(scheduleRequestApprovePath, first.id), {
      method: "POST",
      headers: asUser(approver),
    });
    expect(scheduleRequestSchema.parse(await approved.json()).status).toBe("approved");
    const secondAfter = scheduleRequestsResponseSchema.parse(
      await (await app.request(requestsUrl(secondCarId), { headers: asUser(creator) })).json(),
    );
    expect(secondAfter.requests).toEqual([second]);
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

    const created = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator, worker), "content-type": "application/json" },
      body: JSON.stringify({ carId, days }),
    });
    expect(created.status).toBe(201);
    const request = scheduleRequestSchema.parse(await created.json());

    const denied = await app.request(apiPath(scheduleRequestApprovePath, request.id), {
      method: "POST",
      headers: asUser(creator, worker),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "forbidden" });
    expect(approveCalls).toBe(0);

    const stillRequested = await app.request(requestsUrl(), { headers: asUser(approver, owner) });
    expect(scheduleRequestsResponseSchema.parse(await stillRequested.json()).requests).toEqual([request]);

    const approved = await app.request(apiPath(scheduleRequestApprovePath, request.id), {
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

    const other = await app.request(apiPath(scheduleRequestsPath), {
      method: "POST",
      headers: { ...asUser(creator, worker), "content-type": "application/json" },
      body: JSON.stringify({ carId, days: [{ date: "2026-11-27", shift: "day" }] }),
    });
    const otherRequest = scheduleRequestSchema.parse(await other.json());

    const rejected = await app.request(apiPath(scheduleRequestRejectPath, otherRequest.id), {
      method: "POST",
      headers: asUser(creator, worker),
    });
    expect(rejected.status).toBe(200);
    expect(scheduleRequestSchema.parse(await rejected.json()).status).toBe("rejected");

    const removed = await app.request(apiPath(scheduleRequestDeletePath, otherRequest.id), {
      method: "DELETE",
      headers: asUser(creator, worker),
    });
    expect(removed.status).toBe(200);

    const listed = await app.request(requestsUrl(), { headers: asUser(approver, owner) });
    const body = scheduleRequestsResponseSchema.parse(await listed.json());
    expect(body.requests.map((item) => item.id)).toEqual([request.id]);
    expect(body.requests[0]?.status).toBe("approved");
  });
});
