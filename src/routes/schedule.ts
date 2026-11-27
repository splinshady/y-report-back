import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { ScheduleActor, ScheduleDay, ScheduleStore } from "../db/schedule-types.js";

export const scheduleRequestsPath = "/schedule/requests";
export const scheduleRequestApprovePath = "/schedule/requests/{id}/approve";
export const scheduleRequestRejectPath = "/schedule/requests/{id}/reject";
export const scheduleRequestDeletePath = "/schedule/requests/{id}";

const scheduleShiftSchema = z.enum(["day", "night"]);

const scheduleDaySchema = z.object({
  date: z.string(),
  shift: scheduleShiftSchema,
});

const scheduleActorSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const scheduleRequestSchema = z.object({
  id: z.string(),
  taxiParkId: z.string(),
  carId: z.string(),
  status: z.enum(["requested", "approved", "rejected"]),
  createdBy: scheduleActorSchema,
  approvedBy: scheduleActorSchema.nullable(),
  rejectedBy: scheduleActorSchema.nullable(),
  days: z.array(scheduleDaySchema),
});

export const scheduleRequestsResponseSchema = z.object({
  requests: z.array(scheduleRequestSchema),
});

const scheduleErrorSchema = z.object({
  error: z.enum(["unauthorized", "forbidden", "invalid", "conflict", "none", "missing"]),
});

const createScheduleRequestBodySchema = z.object({
  carId: z.string(),
  days: z.array(scheduleDaySchema).min(1),
});

const errorResponse = {
  description: "Заявку нельзя сохранить",
  content: {
    "application/json": {
      schema: scheduleErrorSchema,
    },
  },
} as const;

const listRoute = createRoute({
  method: "get",
  path: scheduleRequestsPath,
  responses: {
    200: {
      description: "Заявки машины",
      content: {
        "application/json": {
          schema: scheduleRequestsResponseSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});

const createRequestRoute = createRoute({
  method: "post",
  path: scheduleRequestsPath,
  responses: {
    201: {
      description: "Заявка создана",
      content: {
        "application/json": {
          schema: scheduleRequestSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

const removedSchema = z.object({
  ok: z.literal(true),
});

const rejectRoute = createRoute({
  method: "post",
  path: scheduleRequestRejectPath,
  responses: {
    200: {
      description: "Заявка отклонена",
      content: {
        "application/json": {
          schema: scheduleRequestSchema,
        },
      },
    },
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: scheduleRequestDeletePath,
  responses: {
    200: {
      description: "Заявка удалена",
      content: {
        "application/json": {
          schema: removedSchema,
        },
      },
    },
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});

const approveRoute = createRoute({
  method: "post",
  path: scheduleRequestApprovePath,
  responses: {
    200: {
      description: "Заявка утверждена",
      content: {
        "application/json": {
          schema: scheduleRequestSchema,
        },
      },
    },
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function daysAreValid(days: ScheduleDay[]): boolean {
  if (new Set(days.map((day) => day.date)).size !== days.length) {
    return false;
  }

  return days.every((day) => isCalendarDate(day.date));
}

type ScheduleMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

export function createScheduleRoute(options: {
  store: ScheduleStore;
  findCar: (taxiParkId: string, carId: string) => Promise<{ id: string } | null>;
  getSession: (headers: Headers) => Promise<ScheduleActor | null>;
  getMembership: (headers: Headers) => Promise<ScheduleMembership | null>;
}) {
  const route = new OpenAPIHono();

  async function readMember(headers: Headers) {
    const actor = await options.getSession(headers);
    if (!actor) {
      return { error: "unauthorized" as const };
    }

    const membership = await options.getMembership(headers);
    if (!membership) {
      return { error: "forbidden" as const };
    }

    return { actor, membership };
  }

  route.openapi(listRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const carId = c.req.query("carId")?.trim() ?? "";
    if (carId.length === 0) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const car = await options.findCar(access.membership.taxiParkId, carId);
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    const body = scheduleRequestsResponseSchema.parse({
      requests: await options.store.list(access.membership.taxiParkId, car.id),
    });
    return c.json(body, 200);
  });

  route.openapi(createRequestRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const parsed = createScheduleRequestBodySchema.safeParse(json);
    const carId = parsed.success ? parsed.data.carId.trim() : "";
    if (!parsed.success || carId.length === 0 || !daysAreValid(parsed.data.days)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const car = await options.findCar(access.membership.taxiParkId, carId);
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    const created = await options.store.create(
      access.membership.taxiParkId,
      car.id,
      access.actor,
      parsed.data.days,
    );
    if (created === "conflict") {
      return c.json({ error: "conflict" as const }, 409);
    }

    return c.json(scheduleRequestSchema.parse(created), 201);
  });

  route.openapi(approveRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }
    if (access.membership.role !== "owner") {
      return c.json({ error: "forbidden" as const }, 403);
    }

    const updated = await options.store.approve(
      access.membership.taxiParkId,
      access.actor,
      c.req.param("id"),
    );
    if (updated === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }
    if (updated === "none") {
      return c.json({ error: "none" as const }, 409);
    }

    return c.json(scheduleRequestSchema.parse(updated), 200);
  });

  route.openapi(rejectRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const updated = await options.store.reject(
      access.membership.taxiParkId,
      access.actor,
      c.req.param("id"),
    );
    if (updated === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }
    if (updated === "none") {
      return c.json({ error: "none" as const }, 409);
    }

    return c.json(scheduleRequestSchema.parse(updated), 200);
  });

  route.openapi(deleteRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const removed = await options.store.remove(access.membership.taxiParkId, c.req.param("id"));
    if (removed === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }

    return c.json({ ok: true as const }, 200);
  });

  return route;
}
