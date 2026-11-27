import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { CarPhoto, CarPhotoChange, CarStore } from "../db/car-store.js";

export const carsPath = "/cars";
export const carPath = "/cars/{id}";
export const carPhotoPath = "/cars/{id}/photo";

export const carSchema = z.object({
  id: z.string(),
  plate: z.string(),
  hasPhoto: z.boolean(),
});

export const carsResponseSchema = z.object({
  cars: z.array(carSchema),
});

const carErrorSchema = z.object({
  error: z.enum(["unauthorized", "forbidden", "invalid", "missing"]),
});

const photoFileSchema = z.object({
  contentType: z.string(),
  data: z.string(),
});

const createCarBodySchema = z.object({
  plate: z.string(),
  photo: photoFileSchema.nullable().optional(),
});

const updateCarBodySchema = z.object({
  plate: z.string(),
  photo: z.discriminatedUnion("state", [
    z.object({ state: z.literal("keep") }),
    z.object({ state: z.literal("remove") }),
    z.object({
      state: z.literal("replace"),
      contentType: z.string(),
      data: z.string(),
    }),
  ]),
});

const removedSchema = z.object({
  ok: z.literal(true),
});

const errorResponse = {
  description: "Машину нельзя изменить",
  content: {
    "application/json": {
      schema: carErrorSchema,
    },
  },
} as const;

const listRoute = createRoute({
  method: "get",
  path: carsPath,
  responses: {
    200: {
      description: "Машины таксопарка",
      content: {
        "application/json": {
          schema: carsResponseSchema,
        },
      },
    },
    401: errorResponse,
    403: errorResponse,
  },
});

const createCarRoute = createRoute({
  method: "post",
  path: carsPath,
  responses: {
    201: {
      description: "Машина создана",
      content: {
        "application/json": {
          schema: carSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
  },
});

const updateCarRoute = createRoute({
  method: "patch",
  path: carPath,
  responses: {
    200: {
      description: "Машина изменена",
      content: {
        "application/json": {
          schema: carSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});

const deleteCarRoute = createRoute({
  method: "delete",
  path: carPath,
  responses: {
    200: {
      description: "Машина удалена",
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

type ImageSignature = {
  contentType: string;
  matches: (bytes: Uint8Array) => boolean;
};

const imageSignatures: ImageSignature[] = [
  {
    contentType: "image/png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    contentType: "image/jpeg",
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    contentType: "image/gif",
    matches: (bytes) => {
      if (bytes.length < 6) {
        return false;
      }
      const head = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
      return head === "GIF87a" || head === "GIF89a";
    },
  },
  {
    contentType: "image/webp",
    matches: (bytes) => {
      if (bytes.length < 12) {
        return false;
      }
      const riff = Buffer.from(bytes.subarray(0, 4)).toString("ascii");
      const webp = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
      return riff === "RIFF" && webp === "WEBP";
    },
  },
];

export function trimmedPlate(plate: string): string | null {
  const trimmed = plate.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function decodeCarPhoto(contentType: string, data: string): CarPhoto | null {
  const normalized = contentType.trim().toLowerCase();
  const canonical = normalized === "image/jpg" ? "image/jpeg" : normalized;
  const signature = imageSignatures.find((item) => item.contentType === canonical);
  if (!signature || data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return null;
  }

  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || !signature.matches(bytes)) {
    return null;
  }

  return { contentType: canonical, bytes };
}

function photoChange(photo: z.infer<typeof updateCarBodySchema>["photo"]): CarPhotoChange | null {
  if (photo.state === "keep" || photo.state === "remove") {
    return photo;
  }

  const decoded = decodeCarPhoto(photo.contentType, photo.data);
  if (!decoded) {
    return null;
  }

  return { state: "replace", photo: decoded };
}

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

export function createCarsRoute(options: {
  store: CarStore;
  getSession: (headers: Headers) => Promise<{ id: string; name: string } | null>;
  getMembership: (headers: Headers) => Promise<ParkMembership | null>;
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

    const body = carsResponseSchema.parse({
      cars: await options.store.list(access.membership.taxiParkId),
    });
    return c.json(body, 200);
  });

  route.openapi(createCarRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }
    if (access.membership.role !== "owner") {
      return c.json({ error: "forbidden" as const }, 403);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const parsed = createCarBodySchema.safeParse(json);
    const plate = parsed.success ? trimmedPlate(parsed.data.plate) : null;
    const photo = parsed.success && parsed.data.photo ? decodeCarPhoto(parsed.data.photo.contentType, parsed.data.photo.data) : null;
    if (!parsed.success || !plate || (parsed.data.photo != null && !photo)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const created = await options.store.create(access.membership.taxiParkId, plate, photo);
    return c.json(carSchema.parse(created), 201);
  });

  route.openapi(updateCarRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }
    if (access.membership.role !== "owner") {
      return c.json({ error: "forbidden" as const }, 403);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const parsed = updateCarBodySchema.safeParse(json);
    const plate = parsed.success ? trimmedPlate(parsed.data.plate) : null;
    const photo = parsed.success ? photoChange(parsed.data.photo) : null;
    if (!parsed.success || !plate || !photo) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const updated = await options.store.update(
      access.membership.taxiParkId,
      c.req.param("id"),
      plate,
      photo,
    );
    if (updated === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }

    return c.json(carSchema.parse(updated), 200);
  });

  route.openapi(deleteCarRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }
    if (access.membership.role !== "owner") {
      return c.json({ error: "forbidden" as const }, 403);
    }

    const removed = await options.store.remove(access.membership.taxiParkId, c.req.param("id"));
    if (removed === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }

    return c.json({ ok: true as const }, 200);
  });

  route.get(carPhotoPath.replaceAll("{id}", ":id"), async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const carId = c.req.param("id");
    if (!carId) {
      return c.json({ error: "missing" as const }, 404);
    }

    const photo = await options.store.readPhoto(access.membership.taxiParkId, carId);
    if (photo === "missing" || photo === "none") {
      return c.json({ error: "missing" as const }, 404);
    }

    return new Response(new Uint8Array(photo.bytes), {
      status: 200,
      headers: { "content-type": photo.contentType },
    });
  });

  return route;
}
