import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type {
  ShiftReportDraft,
  ShiftReportPhoto,
  ShiftReportRecord,
  ShiftReportShift,
  ShiftReportSlot,
  ShiftReportStore,
} from "../db/shift-report-types.js";
import {
  createShiftReportRoute,
  shiftReportByIdPath,
  shiftReportPhotoPath,
  shiftReportSchema,
  shiftReportsPath,
} from "./shift-report.js";

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

type KnownCar = {
  id: string;
  taxiParkId: string;
};

type ShiftInput = {
  taxiParkId: string;
  carId: string;
  date: string;
  shift: ShiftReportShift;
  status: "requested" | "approved" | "rejected";
};

type StoredReport = ShiftReportRecord & {
  taxiParkId: string;
  photos: [ShiftReportPhoto, ShiftReportPhoto, ShiftReportPhoto, ShiftReportPhoto];
};

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(pngBase64, "base64");

const parkId = "park-1";
const otherParkId = "park-2";
const carId = "car-1";
const secondCarId = "car-2";
const foreignCarId = "car-other";
const todayKey = "2026-11-25";
const yesterdayKey = "2026-11-24";
const tomorrowKey = "2026-11-26";

const owner = { id: "user-anna", name: "Анна" };
const worker = { id: "user-boris", name: "Борис" };

const knownCars: KnownCar[] = [
  { id: carId, taxiParkId: parkId },
  { id: secondCarId, taxiParkId: parkId },
  { id: foreignCarId, taxiParkId: otherParkId },
];

const enteredNumbers = {
  mileageStart: -1.5,
  mileageEnd: 180.25,
  cashless: 10,
  cash: 20,
  discount: 1,
  tip: 2,
  wash: 3,
  lineTime: 8.5,
  cashStart: 50,
  cashEnd: 70,
  shiftTotal: 7,
};

function photoFile() {
  return { contentType: "image/png", data: pngBase64 };
}

function reportBody(
  overrides: {
    carId?: string;
    date?: string;
    shift?: ShiftReportShift;
    mileageStart?: number | null;
    photos?: Array<{ contentType: string; data: string }>;
  } = {},
) {
  const body: Record<string, unknown> = {
    carId,
    date: todayKey,
    shift: "day",
    ...enteredNumbers,
    photos: [photoFile(), photoFile(), photoFile(), photoFile()],
  };

  if ("mileageStart" in overrides) {
    body.mileageStart = overrides.mileageStart;
  }
  if (overrides.carId) {
    body.carId = overrides.carId;
  }
  if (overrides.date) {
    body.date = overrides.date;
  }
  if (overrides.shift) {
    body.shift = overrides.shift;
  }
  if (overrides.photos) {
    body.photos = overrides.photos;
  }

  return body;
}

function zeroNumbers() {
  return {
    mileageStart: 0,
    mileageEnd: 0,
    cashless: 0,
    cash: 0,
    discount: 0,
    tip: 0,
    wash: 0,
    lineTime: 0,
    cashStart: 0,
    cashEnd: 0,
    shiftTotal: 0,
  };
}

function createMemoryStore() {
  const reports: StoredReport[] = [];
  const calls = { create: 0, read: 0, readPhoto: 0, list: 0, readById: 0 };

  const store: ShiftReportStore = {
    async create(taxiParkId, draft: ShiftReportDraft) {
      calls.create += 1;
      const existing = reports.find(
        (report) =>
          report.taxiParkId === taxiParkId &&
          report.carId === draft.carId &&
          report.date === draft.date &&
          report.shift === draft.shift,
      );
      if (existing) {
        return "conflict";
      }

      const report: StoredReport = {
        id: `report-${reports.length + 1}`,
        taxiParkId,
        carId: draft.carId,
        date: draft.date,
        shift: draft.shift,
        mileageStart: draft.mileageStart,
        mileageEnd: draft.mileageEnd,
        cashless: draft.cashless,
        cash: draft.cash,
        discount: draft.discount,
        tip: draft.tip,
        wash: draft.wash,
        lineTime: draft.lineTime,
        cashStart: draft.cashStart,
        cashEnd: draft.cashEnd,
        shiftTotal: draft.shiftTotal,
        photos: draft.photos.map((item) => ({
          contentType: item.contentType,
          bytes: Buffer.from(item.bytes),
        })) as StoredReport["photos"],
      };
      reports.push(report);
      return {
        id: report.id,
        carId: report.carId,
        date: report.date,
        shift: report.shift,
        mileageStart: report.mileageStart,
        mileageEnd: report.mileageEnd,
        cashless: report.cashless,
        cash: report.cash,
        discount: report.discount,
        tip: report.tip,
        wash: report.wash,
        lineTime: report.lineTime,
        cashStart: report.cashStart,
        cashEnd: report.cashEnd,
        shiftTotal: report.shiftTotal,
      };
    },
    async list(taxiParkId, requestCarId) {
      calls.list += 1;
      return reports
        .filter((item) => item.taxiParkId === taxiParkId && item.carId === requestCarId)
        .sort((left, right) => {
          if (left.date !== right.date) {
            return right.date.localeCompare(left.date);
          }
          return left.shift.localeCompare(right.shift);
        })
        .map((report) => ({
          id: report.id,
          carId: report.carId,
          date: report.date,
          shift: report.shift,
          mileageStart: report.mileageStart,
          mileageEnd: report.mileageEnd,
          cashless: report.cashless,
          cash: report.cash,
          discount: report.discount,
          tip: report.tip,
          wash: report.wash,
          lineTime: report.lineTime,
          cashStart: report.cashStart,
          cashEnd: report.cashEnd,
          shiftTotal: report.shiftTotal,
        }));
    },
    async readById(taxiParkId, reportId) {
      calls.readById += 1;
      const report = reports.find((item) => item.taxiParkId === taxiParkId && item.id === reportId);
      if (!report) {
        return null;
      }

      return {
        id: report.id,
        carId: report.carId,
        date: report.date,
        shift: report.shift,
        mileageStart: report.mileageStart,
        mileageEnd: report.mileageEnd,
        cashless: report.cashless,
        cash: report.cash,
        discount: report.discount,
        tip: report.tip,
        wash: report.wash,
        lineTime: report.lineTime,
        cashStart: report.cashStart,
        cashEnd: report.cashEnd,
        shiftTotal: report.shiftTotal,
      };
    },
    async read(taxiParkId, requestCarId, date, shift) {
      calls.read += 1;
      const report = reports.find(
        (item) =>
          item.taxiParkId === taxiParkId &&
          item.carId === requestCarId &&
          item.date === date &&
          item.shift === shift,
      );
      if (!report) {
        return null;
      }

      return {
        id: report.id,
        carId: report.carId,
        date: report.date,
        shift: report.shift,
        mileageStart: report.mileageStart,
        mileageEnd: report.mileageEnd,
        cashless: report.cashless,
        cash: report.cash,
        discount: report.discount,
        tip: report.tip,
        wash: report.wash,
        lineTime: report.lineTime,
        cashStart: report.cashStart,
        cashEnd: report.cashEnd,
        shiftTotal: report.shiftTotal,
      };
    },
    async readPhoto(taxiParkId, reportId, slot: ShiftReportSlot) {
      calls.readPhoto += 1;
      const report = reports.find((item) => item.id === reportId && item.taxiParkId === taxiParkId);
      if (!report) {
        return "missing";
      }

      const photo = report.photos[slot - 1];
      if (!photo) {
        return "missing";
      }

      return { contentType: photo.contentType, bytes: Buffer.from(photo.bytes) };
    },
  };

  return { store, calls, reports };
}

function createApp(store: ShiftReportStore, shifts: ShiftInput[]) {
  const app = new OpenAPIHono();
  app.route(
    "/api",
    createShiftReportRoute({
      store,
      findCar: async (taxiParkId, id) => {
        const car = knownCars.find((item) => item.id === id && item.taxiParkId === taxiParkId);
        return car ? { id: car.id } : null;
      },
      hasApprovedShift: async (taxiParkId, id, date, shift) =>
        shifts.some(
          (item) =>
            item.taxiParkId === taxiParkId &&
            item.carId === id &&
            item.date === date &&
            item.shift === shift &&
            item.status === "approved",
        ),
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

function apiPath(path: string, params: Record<string, string> = {}) {
  let resolved = path;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return `/api${resolved}`;
}

function reportUrl(id: string, date: string, shift: ShiftReportShift) {
  return `${apiPath(shiftReportsPath)}?carId=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`;
}

function asUser(
  actor: { id: string; name: string } | null,
  membership: ParkMembership | null = { taxiParkId: parkId, role: "owner" },
): HeadersInit {
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

function jsonRequest(
  actor: { id: string; name: string } | null,
  membership: ParkMembership | null,
  body: unknown,
) {
  return {
    method: "POST" as const,
    headers: { ...asUser(actor, membership), "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function approved(id: string, date: string, shift: ShiftReportShift, taxiParkId = parkId): ShiftInput {
  return { taxiParkId, carId: id, date, shift, status: "approved" };
}

describe("shift report", () => {
  it("без сессии не создаёт и не читает отчёт", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);

    const created = await app.request(apiPath(shiftReportsPath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reportBody()),
    });
    const read = await app.request(reportUrl(carId, todayKey, "day"));
    const photo = await app.request(apiPath(shiftReportPhotoPath, { id: "report-1", slot: "1" }));

    expect(created.status).toBe(401);
    expect(read.status).toBe(401);
    expect(photo.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
    expect(memory.calls).toEqual({ create: 0, read: 0, readPhoto: 0, list: 0, readById: 0 });
  });

  it("без таксопарка не создаёт и не читает отчёт", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);

    const created = await app.request(apiPath(shiftReportsPath), jsonRequest(owner, null, reportBody()));
    const read = await app.request(reportUrl(carId, todayKey, "day"), { headers: asUser(owner, null) });

    expect(created.status).toBe(403);
    expect(read.status).toBe(403);
    expect(await created.json()).toEqual({ error: "forbidden" });
    expect(memory.calls.create).toBe(0);
  });

  it("пустое число не создаёт отчёт", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);
    const body = reportBody();
    delete body.mileageEnd;

    const created = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, body),
    );

    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "invalid", fields: { mileageEnd: "required" } });
    expect(memory.calls.create).toBe(0);
    expect(memory.reports).toHaveLength(0);
  });

  it("ноль сохраняется и читается", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);
    const body = { ...reportBody(), ...zeroNumbers() };

    const created = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, body),
    );
    const read = await app.request(reportUrl(carId, todayKey, "day"), {
      headers: asUser(owner),
    });

    expect(created.status).toBe(201);
    expect(shiftReportSchema.parse(await created.json())).toMatchObject({
      carId,
      date: todayKey,
      shift: "day",
      ...zeroNumbers(),
    });
    expect(await read.json()).toMatchObject(zeroNumbers());
  });

  it("без любого из четырёх фото отчёт не создаётся", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);
    const short = reportBody({ photos: [photoFile(), photoFile(), photoFile()] });
    const broken = reportBody({
      photos: [photoFile(), photoFile(), photoFile(), { contentType: "image/png", data: "aaaa" }],
    });

    const missing = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, short),
    );
    const invalid = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, broken),
    );

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid", fields: { photo4: "required" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid", fields: { photo4: "image" } });
    expect(memory.calls.create).toBe(0);
  });

  it("неутверждённая смена не создаёт отчёт", async () => {
    const shifts: ShiftInput[] = [
      { taxiParkId: parkId, carId, date: todayKey, shift: "day", status: "requested" },
      { taxiParkId: parkId, carId, date: yesterdayKey, shift: "night", status: "rejected" },
    ];
    const memory = createMemoryStore();
    const app = createApp(memory.store, shifts);

    const requested = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody()),
    );
    const rejected = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody({ date: yesterdayKey, shift: "night" })),
    );
    const missing = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(worker, { taxiParkId: parkId, role: "worker" }, reportBody({ shift: "night" })),
    );

    expect(requested.status).toBe(400);
    expect(await requested.json()).toEqual({ error: "invalid", form: "shift" });
    expect(rejected.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(memory.calls.create).toBe(0);
  });

  it("отчёт создаётся на завтра, сегодня и вчера", async () => {
    const memory = createMemoryStore();
    const shifts = [
      approved(carId, todayKey, "day"),
      approved(carId, yesterdayKey, "day"),
      approved(carId, tomorrowKey, "day"),
    ];
    const app = createApp(memory.store, shifts);

    const future = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody({ date: tomorrowKey })),
    );
    const current = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody({ date: todayKey })),
    );
    const past = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(worker, { taxiParkId: parkId, role: "worker" }, reportBody({ date: yesterdayKey })),
    );

    expect(future.status).toBe(201);
    expect(current.status).toBe(201);
    expect(past.status).toBe(201);
    expect(memory.reports.map((report) => report.date)).toEqual([tomorrowKey, todayKey, yesterdayKey]);
  });

  it("дневной и ночной отчёты проходят, повтор смены нет, другая машина свободна", async () => {
    const memory = createMemoryStore();
    const shifts = [
      approved(carId, todayKey, "day"),
      approved(carId, todayKey, "night"),
      approved(secondCarId, todayKey, "day"),
    ];
    const app = createApp(memory.store, shifts);
    const membership = { taxiParkId: parkId, role: "owner" as const };

    const day = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, membership, reportBody({ shift: "day" })),
    );
    const night = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(worker, { taxiParkId: parkId, role: "worker" }, reportBody({ shift: "night" })),
    );
    const duplicate = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, membership, reportBody({ shift: "day" })),
    );
    const otherCar = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, membership, reportBody({ carId: secondCarId, shift: "day" })),
    );

    expect(day.status).toBe(201);
    expect(night.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "conflict", form: "duplicate" });
    expect(otherCar.status).toBe(201);

    const savedDay = await app.request(reportUrl(carId, todayKey, "day"), { headers: asUser(owner) });
    const savedNight = await app.request(reportUrl(carId, todayKey, "night"), { headers: asUser(worker) });
    expect(await savedDay.json()).toMatchObject({ shift: "day", shiftTotal: enteredNumbers.shiftTotal });
    expect(await savedNight.json()).toMatchObject({ shift: "night", shiftTotal: enteredNumbers.shiftTotal });
    expect(memory.reports.filter((report) => report.carId === carId && report.shift === "day")).toHaveLength(1);
  });

  it("после создания отдаёт введённые числа и фото без подписи", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [approved(carId, todayKey, "day")]);
    const created = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody()),
    );
    const body = shiftReportSchema.parse(await created.json());

    expect(body).toEqual({
      id: "report-1",
      carId,
      date: todayKey,
      shift: "day",
      ...enteredNumbers,
    });

    const photo = await app.request(apiPath(shiftReportPhotoPath, { id: body.id, slot: "2" }), {
      headers: asUser(owner),
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(pngBytes);
    expect(JSON.stringify(body)).not.toContain("caption");
  });

  it("чужой таксопарк не создаёт и не читает отчёт", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store, [
      approved(carId, todayKey, "day", parkId),
      approved(foreignCarId, todayKey, "day", otherParkId),
    ]);
    const created = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody()),
    );
    const saved = shiftReportSchema.parse(await created.json());
    const foreignMembership = { taxiParkId: otherParkId, role: "worker" as const };

    const foreignCreate = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(worker, foreignMembership, reportBody({ carId })),
    );
    const foreignRead = await app.request(reportUrl(carId, todayKey, "day"), {
      headers: asUser(worker, foreignMembership),
    });
    const foreignPhoto = await app.request(apiPath(shiftReportPhotoPath, { id: saved.id, slot: "1" }), {
      headers: asUser(worker, foreignMembership),
    });
    const ownRead = await app.request(reportUrl(carId, todayKey, "day"), { headers: asUser(owner) });

    expect(foreignCreate.status).toBe(404);
    expect(foreignRead.status).toBe(404);
    expect(foreignPhoto.status).toBe(404);
    expect(await ownRead.json()).toMatchObject({ shiftTotal: enteredNumbers.shiftTotal });
  });

  it("владелец и работник своего парка создают отчёт", async () => {
    const ownerMemory = createMemoryStore();
    const workerMemory = createMemoryStore();
    const shifts = [approved(carId, todayKey, "day")];
    const ownerApp = createApp(ownerMemory.store, shifts);
    const workerApp = createApp(workerMemory.store, shifts);

    const ownerCreated = await ownerApp.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody()),
    );
    const workerCreated = await workerApp.request(
      apiPath(shiftReportsPath),
      jsonRequest(worker, { taxiParkId: parkId, role: "worker" }, reportBody()),
    );

    expect(ownerCreated.status).toBe(201);
    expect(workerCreated.status).toBe(201);
    expect(ownerMemory.reports).toHaveLength(1);
    expect(workerMemory.reports).toHaveLength(1);
  });

  it("список машины отдаёт её отчёты, чужой парк по идентификатору не читает", async () => {
    const memory = createMemoryStore();
    const shifts = [approved(carId, todayKey, "day"), approved(carId, todayKey, "night")];
    const app = createApp(memory.store, shifts);
    const headers = asUser(owner);

    const day = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody({ shift: "day" })),
    );
    const night = await app.request(
      apiPath(shiftReportsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, reportBody({ shift: "night" })),
    );
    const dayReport = shiftReportSchema.parse(await day.json());
    const listed = await app.request(
      `${apiPath(shiftReportsPath)}?carId=${encodeURIComponent(carId)}`,
      { headers },
    );
    const byId = await app.request(apiPath(shiftReportByIdPath, { id: dayReport.id }), { headers });
    const foreign = await app.request(apiPath(shiftReportByIdPath, { id: dayReport.id }), {
      headers: asUser(owner, { taxiParkId: otherParkId, role: "owner" }),
    });

    expect(day.status).toBe(201);
    expect(night.status).toBe(201);
    expect(await listed.json()).toMatchObject({
      reports: [
        { id: dayReport.id, shift: "day" },
        { shift: "night" },
      ],
    });
    expect(await byId.json()).toMatchObject({ id: dayReport.id, shiftTotal: enteredNumbers.shiftTotal });
    expect(foreign.status).toBe(404);
  });
});
