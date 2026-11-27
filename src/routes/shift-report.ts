import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type {
  ShiftReportPhoto,
  ShiftReportShift,
  ShiftReportSlot,
  ShiftReportStore,
} from "../db/shift-report-types.js";
import { decodeCarPhoto } from "./cars.js";

export const shiftReportsPath = "/shift-reports";
export const shiftReportByIdPath = "/shift-reports/{id}";
export const shiftReportPhotoPath = "/shift-reports/{id}/photos/{slot}";

const shiftReportShiftSchema = z.enum(["day", "night"]);

const photoFileSchema = z.object({
  contentType: z.string(),
  data: z.string(),
});

export const shiftReportSchema = z.object({
  id: z.string(),
  carId: z.string(),
  date: z.string(),
  shift: shiftReportShiftSchema,
  mileageStart: z.number(),
  mileageEnd: z.number(),
  cashless: z.number(),
  cash: z.number(),
  discount: z.number(),
  tip: z.number(),
  wash: z.number(),
  lineTime: z.number(),
  cashStart: z.number(),
  cashEnd: z.number(),
  shiftTotal: z.number(),
});

const shiftReportFieldCodeSchema = z.enum(["required", "number", "date", "image"]);

const shiftReportNumberKeys = [
  "mileageStart",
  "mileageEnd",
  "cashless",
  "cash",
  "discount",
  "tip",
  "wash",
  "lineTime",
  "cashStart",
  "cashEnd",
  "shiftTotal",
] as const;

const shiftReportPhotoKeys = ["photo1", "photo2", "photo3", "photo4"] as const;

const shiftReportFieldsSchema = z.object({
  date: shiftReportFieldCodeSchema.optional(),
  mileageStart: shiftReportFieldCodeSchema.optional(),
  mileageEnd: shiftReportFieldCodeSchema.optional(),
  cashless: shiftReportFieldCodeSchema.optional(),
  cash: shiftReportFieldCodeSchema.optional(),
  discount: shiftReportFieldCodeSchema.optional(),
  tip: shiftReportFieldCodeSchema.optional(),
  wash: shiftReportFieldCodeSchema.optional(),
  lineTime: shiftReportFieldCodeSchema.optional(),
  cashStart: shiftReportFieldCodeSchema.optional(),
  cashEnd: shiftReportFieldCodeSchema.optional(),
  shiftTotal: shiftReportFieldCodeSchema.optional(),
  photo1: shiftReportFieldCodeSchema.optional(),
  photo2: shiftReportFieldCodeSchema.optional(),
  photo3: shiftReportFieldCodeSchema.optional(),
  photo4: shiftReportFieldCodeSchema.optional(),
});

const shiftReportErrorSchema = z.object({
  error: z.enum(["unauthorized", "forbidden", "invalid", "conflict", "missing"]),
  fields: shiftReportFieldsSchema.optional(),
  form: z.enum(["shift", "duplicate"]).optional(),
});

type ShiftReportFieldErrors = z.infer<typeof shiftReportFieldsSchema>;

const createShiftReportBodySchema = z.object({
  carId: z.string(),
  date: z.string(),
  shift: shiftReportShiftSchema,
  mileageStart: z.number(),
  mileageEnd: z.number(),
  cashless: z.number(),
  cash: z.number(),
  discount: z.number(),
  tip: z.number(),
  wash: z.number(),
  lineTime: z.number(),
  cashStart: z.number(),
  cashEnd: z.number(),
  shiftTotal: z.number(),
  photos: z.tuple([photoFileSchema, photoFileSchema, photoFileSchema, photoFileSchema]),
});

const errorResponse = {
  description: "Отчёт нельзя сохранить",
  content: {
    "application/json": {
      schema: shiftReportErrorSchema,
    },
  },
} as const;

const shiftReportListSchema = z.object({
  reports: z.array(shiftReportSchema),
});

const shiftReportReadResponseSchema = z.union([shiftReportSchema, shiftReportListSchema]);

const readShiftReportRoute = createRoute({
  method: "get",
  path: shiftReportsPath,
  responses: {
    200: {
      description: "Отчёт смены или список отчётов машины",
      content: {
        "application/json": {
          schema: shiftReportReadResponseSchema,
        },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});

const readShiftReportByIdRoute = createRoute({
  method: "get",
  path: shiftReportByIdPath,
  responses: {
    200: {
      description: "Отчёт по идентификатору",
      content: {
        "application/json": {
          schema: shiftReportSchema,
        },
      },
    },
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});

const createShiftReportRouteDef = createRoute({
  method: "post",
  path: shiftReportsPath,
  responses: {
    201: {
      description: "Отчёт создан",
      content: {
        "application/json": {
          schema: shiftReportSchema,
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


function rawRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "object" && body !== null) {
    return body as Record<string, unknown>;
  }

  return {};
}

function photoField(index: number): (typeof shiftReportPhotoKeys)[number] | null {
  return shiftReportPhotoKeys[index] ?? null;
}

function isNumberKey(value: PropertyKey): value is (typeof shiftReportNumberKeys)[number] {
  return typeof value === "string" && shiftReportNumberKeys.some((key) => key === value);
}

function assignIssue(fields: ShiftReportFieldErrors, path: PropertyKey[], raw: Record<string, unknown>) {
  const head = path[0];
  if (head === "date") {
    const value = raw.date;
    fields.date = value == null || value === "" ? "required" : "date";
    return;
  }

  if (isNumberKey(head)) {
    const value = raw[head];
    fields[head] = value == null || value === "" ? "required" : "number";
    return;
  }

  if (head !== "photos") {
    return;
  }

  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  const index = path[1];
  if (typeof index === "number") {
    const key = photoField(index);
    if (!key) {
      return;
    }
    fields[key] = photos[index] == null ? "required" : "image";
    return;
  }

  for (let slot = 0; slot < shiftReportPhotoKeys.length; slot += 1) {
    const key = photoField(slot);
    if (key && photos[slot] == null) {
      fields[key] = "required";
    }
  }
}

function invalidBody(fields: ShiftReportFieldErrors, form?: "shift") {
  return shiftReportErrorSchema.parse({
    error: "invalid",
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(form ? { form } : {}),
  });
}

function shiftReportInputErrors(body: unknown): ShiftReportFieldErrors | null {
  const raw = rawRecord(body);
  const parsed = createShiftReportBodySchema.safeParse(body);
  if (!parsed.success) {
    const fields: ShiftReportFieldErrors = {};
    for (const issue of parsed.error.issues) {
      assignIssue(fields, issue.path, raw);
    }
    if (typeof raw.date === "string" && raw.date.trim().length > 0 && !isCalendarDate(raw.date)) {
      fields.date = "date";
    }
    return fields;
  }

  if (parsed.data.carId.trim().length === 0) {
    return {};
  }

  if (!isCalendarDate(parsed.data.date)) {
    return { date: "date" };
  }

  return null;
}

function readShift(value: string | undefined): ShiftReportShift | null {
  if (value === "day" || value === "night") {
    return value;
  }

  return null;
}

function readSlot(value: string | undefined): ShiftReportSlot | null {
  if (value === "1" || value === "2" || value === "3" || value === "4") {
    return Number(value) as ShiftReportSlot;
  }

  return null;
}

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

export function createShiftReportRoute(options: {
  store: ShiftReportStore;
  findCar: (taxiParkId: string, carId: string) => Promise<{ id: string } | null>;
  hasApprovedShift: (
    taxiParkId: string,
    carId: string,
    date: string,
    shift: ShiftReportShift,
  ) => Promise<boolean>;
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

  route.openapi(readShiftReportRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const carId = c.req.query("carId")?.trim() ?? "";
    const dateQuery = c.req.query("date");
    const shiftQuery = c.req.query("shift");
    if (carId.length === 0) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const car = await options.findCar(access.membership.taxiParkId, carId);
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    if (dateQuery == null && shiftQuery == null) {
      const reports = await options.store.list(access.membership.taxiParkId, car.id);
      return c.json(shiftReportListSchema.parse({ reports }), 200);
    }

    const date = dateQuery?.trim() ?? "";
    const shift = readShift(shiftQuery);
    if (!shift || !isCalendarDate(date)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const report = await options.store.read(access.membership.taxiParkId, car.id, date, shift);
    if (!report) {
      return c.json({ error: "missing" as const }, 404);
    }

    return c.json(shiftReportSchema.parse(report), 200);
  });

  route.openapi(readShiftReportByIdRoute, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const reportId = c.req.param("id");
    if (!reportId) {
      return c.json({ error: "missing" as const }, 404);
    }

    const report = await options.store.readById(access.membership.taxiParkId, reportId);
    if (!report) {
      return c.json({ error: "missing" as const }, 404);
    }

    return c.json(shiftReportSchema.parse(report), 200);
  });

  route.openapi(createShiftReportRouteDef, async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const json: unknown = await c.req.json().catch(() => null);
    const inputErrors = shiftReportInputErrors(json);
    if (inputErrors) {
      return c.json(invalidBody(inputErrors), 400);
    }

    const parsed = createShiftReportBodySchema.parse(json);
    const photos = parsed.photos.map((photo) => decodeCarPhoto(photo.contentType, photo.data));
    const photoErrors: ShiftReportFieldErrors = {};
    photos.forEach((photo, index) => {
      const key = photoField(index);
      if (!photo && key) {
        photoErrors[key] = "image";
      }
    });
    if (Object.keys(photoErrors).length > 0) {
      return c.json(invalidBody(photoErrors), 400);
    }

    const decoded = photos as [
      ShiftReportPhoto,
      ShiftReportPhoto,
      ShiftReportPhoto,
      ShiftReportPhoto,
    ];
    const car = await options.findCar(access.membership.taxiParkId, parsed.carId.trim());
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    const approved = await options.hasApprovedShift(
      access.membership.taxiParkId,
      car.id,
      parsed.date,
      parsed.shift,
    );
    if (!approved) {
      return c.json(invalidBody({}, "shift"), 400);
    }

    const created = await options.store.create(access.membership.taxiParkId, {
      carId: car.id,
      date: parsed.date,
      shift: parsed.shift,
      mileageStart: parsed.mileageStart,
      mileageEnd: parsed.mileageEnd,
      cashless: parsed.cashless,
      cash: parsed.cash,
      discount: parsed.discount,
      tip: parsed.tip,
      wash: parsed.wash,
      lineTime: parsed.lineTime,
      cashStart: parsed.cashStart,
      cashEnd: parsed.cashEnd,
      shiftTotal: parsed.shiftTotal,
      photos: decoded,
    });
    if (created === "conflict") {
      return c.json(shiftReportErrorSchema.parse({ error: "conflict", form: "duplicate" }), 409);
    }

    return c.json(shiftReportSchema.parse(created), 201);
  });

  route.get(shiftReportPhotoPath.replaceAll("{id}", ":id").replaceAll("{slot}", ":slot"), async (c) => {
    const access = await readMember(c.req.raw.headers);
    if ("error" in access) {
      return access.error === "unauthorized"
        ? c.json({ error: "unauthorized" as const }, 401)
        : c.json({ error: "forbidden" as const }, 403);
    }

    const reportId = c.req.param("id");
    const slot = readSlot(c.req.param("slot"));
    if (!reportId || !slot) {
      return c.json({ error: "missing" as const }, 404);
    }

    const photo = await options.store.readPhoto(access.membership.taxiParkId, reportId, slot);
    if (photo === "missing") {
      return c.json({ error: "missing" as const }, 404);
    }

    return new Response(new Uint8Array(photo.bytes), {
      status: 200,
      headers: { "content-type": photo.contentType },
    });
  });

  return route;
}
