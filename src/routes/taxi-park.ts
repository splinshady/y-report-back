import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { TaxiParkStore } from "../db/taxi-park-store.js";

export const taxiParkPath = "/taxi-park";
export const taxiParkInvitePath = "/taxi-park/invite";

const taxiParkRoleSchema = z.enum(["owner", "worker"]);

const taxiParkMembershipSchema = z.object({
  taxiParkId: z.string(),
  name: z.string(),
  role: taxiParkRoleSchema,
});

export const taxiParkMembershipResponseSchema = z.object({
  membership: taxiParkMembershipSchema.nullable(),
});

const taxiParkErrorSchema = z.object({
  error: z.enum(["unauthorized", "forbidden", "invalid", "conflict", "missing"]),
});

const createTaxiParkBodySchema = z.object({
  name: z.string(),
});

const inviteWorkerBodySchema = z.object({
  userId: z.string(),
});

const errorResponse = {
  description: "Таксопарк нельзя изменить",
  content: {
    "application/json": {
      schema: taxiParkErrorSchema,
    },
  },
} as const;

const readRoute = createRoute({
  method: "get",
  path: taxiParkPath,
  responses: {
    200: {
      description: "Членство в таксопарке",
      content: {
        "application/json": {
          schema: taxiParkMembershipResponseSchema,
        },
      },
    },
    401: errorResponse,
  },
});

const createParkRoute = createRoute({
  method: "post",
  path: taxiParkPath,
  responses: {
    201: {
      description: "Таксопарк создан",
      content: {
        "application/json": {
          schema: taxiParkMembershipResponseSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    409: errorResponse,
  },
});

const inviteRoute = createRoute({
  method: "post",
  path: taxiParkInvitePath,
  responses: {
    201: {
      description: "Работник добавлен",
      content: {
        "application/json": {
          schema: taxiParkMembershipResponseSchema,
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

function blankName(name: string): boolean {
  return name.trim().length === 0;
}

export function createTaxiParkRoute(options: {
  store: TaxiParkStore;
  getSession: (headers: Headers) => Promise<{ id: string } | null>;
}) {
  const route = new OpenAPIHono();

  route.openapi(readRoute, async (c) => {
    const actor = await options.getSession(c.req.raw.headers);
    if (!actor) {
      return c.json({ error: "unauthorized" as const }, 401);
    }

    const membership = await options.store.readMembership(actor.id);
    return c.json(taxiParkMembershipResponseSchema.parse({ membership }), 200);
  });

  route.openapi(createParkRoute, async (c) => {
    const actor = await options.getSession(c.req.raw.headers);
    if (!actor) {
      return c.json({ error: "unauthorized" as const }, 401);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const parsed = createTaxiParkBodySchema.safeParse(json);
    if (!parsed.success || blankName(parsed.data.name)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const created = await options.store.createPark(actor.id, parsed.data.name.trim());
    if (created === "conflict") {
      return c.json({ error: "conflict" as const }, 409);
    }

    return c.json(taxiParkMembershipResponseSchema.parse({ membership: created }), 201);
  });

  route.openapi(inviteRoute, async (c) => {
    const actor = await options.getSession(c.req.raw.headers);
    if (!actor) {
      return c.json({ error: "unauthorized" as const }, 401);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const parsed = inviteWorkerBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const invited = await options.store.inviteWorker(actor.id, parsed.data.userId);
    if (invited === "forbidden") {
      return c.json({ error: "forbidden" as const }, 403);
    }
    if (invited === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }
    if (invited === "conflict") {
      return c.json({ error: "conflict" as const }, 409);
    }

    return c.json(taxiParkMembershipResponseSchema.parse({ membership: invited }), 201);
  });

  return route;
}
