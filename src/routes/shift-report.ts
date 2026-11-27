import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type {
  ShiftReportPhoto,
  ShiftReportShift,
  ShiftReportSlot,
  ShiftReportStore,
} from "../db/shift-report-types.js";
import { decodeCarPhoto } from "./cars.js";

export const shiftReportsPath = "/shift-reports";
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

const shiftReportErrorSchema = z.object({
  error: z.enum(["unauthorized", "forbidden", "invalid", "conflict", "missing"]),
});

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

const readShiftReportRoute = createRoute({
  method: "get",
  path: shiftReportsPath,
  responses: {
    200: {
      description: "Отчёт смены",
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

export function isShiftReportDateAllowed(value: string, today: Date): boolean {
  if (!isCalendarDate(value)) {
    return false;
  }

  const todayMonth = String(today.getMonth() + 1).padStart(2, "0");
  const todayDay = String(today.getDate()).padStart(2, "0");
  const todayKey = `${today.getFullYear()}-${todayMonth}-${todayDay}`;
  return value <= todayKey;
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
  today: () => Date;
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
    const date = c.req.query("date")?.trim() ?? "";
    const shift = readShift(c.req.query("shift"));
    if (carId.length === 0 || !shift || !isCalendarDate(date)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const car = await options.findCar(access.membership.taxiParkId, carId);
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    const report = await options.store.read(access.membership.taxiParkId, car.id, date, shift);
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
    const parsed = createShiftReportBodySchema.safeParse(json);
    const carId = parsed.success ? parsed.data.carId.trim() : "";
    if (!parsed.success || carId.length === 0 || !isShiftReportDateAllowed(parsed.data.date, options.today())) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const photos = parsed.data.photos.map((photo) => decodeCarPhoto(photo.contentType, photo.data));
    if (photos.some((photo) => photo == null)) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const decoded = photos as [
      ShiftReportPhoto,
      ShiftReportPhoto,
      ShiftReportPhoto,
      ShiftReportPhoto,
    ];
    const car = await options.findCar(access.membership.taxiParkId, carId);
    if (!car) {
      return c.json({ error: "missing" as const }, 404);
    }

    const approved = await options.hasApprovedShift(
      access.membership.taxiParkId,
      car.id,
      parsed.data.date,
      parsed.data.shift,
    );
    if (!approved) {
      return c.json({ error: "invalid" as const }, 400);
    }

    const created = await options.store.create(access.membership.taxiParkId, {
      carId: car.id,
      date: parsed.data.date,
      shift: parsed.data.shift,
      mileageStart: parsed.data.mileageStart,
      mileageEnd: parsed.data.mileageEnd,
      cashless: parsed.data.cashless,
      cash: parsed.data.cash,
      discount: parsed.data.discount,
      tip: parsed.data.tip,
      wash: parsed.data.wash,
      lineTime: parsed.data.lineTime,
      cashStart: parsed.data.cashStart,
      cashEnd: parsed.data.cashEnd,
      shiftTotal: parsed.data.shiftTotal,
      photos: decoded,
    });
    if (created === "conflict") {
      return c.json({ error: "conflict" as const }, 409);
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
