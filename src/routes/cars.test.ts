import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { CarPhoto, CarPhotoChange, CarStore, CarSummary } from "../db/car-store.js";
import { carPath, carPhotoPath, carSchema, carsPath, carsResponseSchema, createCarsRoute } from "./cars.js";

type StoredCar = {
  id: string;
  taxiParkId: string;
  plate: string;
  photo: CarPhoto | null;
};

type ParkMembership = {
  taxiParkId: string;
  role: "owner" | "worker";
};

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(pngBase64, "base64");
const gifBytes = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x01])]);

function summary(car: StoredCar): CarSummary {
  return { id: car.id, plate: car.plate, hasPhoto: car.photo != null };
}

function createMemoryStore() {
  const cars: StoredCar[] = [];
  const calls = { list: 0, create: 0, update: 0, remove: 0, readPhoto: 0 };

  const store: CarStore = {
    async list(taxiParkId) {
      calls.list += 1;
      return cars.filter((car) => car.taxiParkId === taxiParkId).map((car) => summary(car));
    },
    async read(taxiParkId, carId) {
      const car = cars.find((item) => item.id === carId && item.taxiParkId === taxiParkId);
      return car ? summary(car) : null;
    },
    async create(taxiParkId, plate, photo) {
      calls.create += 1;
      const car: StoredCar = {
        id: `car-${cars.length + 1}`,
        taxiParkId,
        plate,
        photo: photo ? { contentType: photo.contentType, bytes: Buffer.from(photo.bytes) } : null,
      };
      cars.push(car);
      return summary(car);
    },
    async update(taxiParkId, carId, plate, photo: CarPhotoChange) {
      calls.update += 1;
      const car = cars.find((item) => item.id === carId && item.taxiParkId === taxiParkId);
      if (!car) {
        return "missing";
      }

      car.plate = plate;
      if (photo.state === "remove") {
        car.photo = null;
      }
      if (photo.state === "replace") {
        car.photo = { contentType: photo.photo.contentType, bytes: Buffer.from(photo.photo.bytes) };
      }
      return summary(car);
    },
    async remove(taxiParkId, carId) {
      calls.remove += 1;
      const index = cars.findIndex((item) => item.id === carId && item.taxiParkId === taxiParkId);
      if (index < 0) {
        return "missing";
      }

      cars.splice(index, 1);
      return "deleted";
    },
    async readPhoto(taxiParkId, carId) {
      calls.readPhoto += 1;
      const car = cars.find((item) => item.id === carId && item.taxiParkId === taxiParkId);
      if (!car) {
        return "missing";
      }
      if (!car.photo) {
        return "none";
      }

      return { contentType: car.photo.contentType, bytes: Buffer.from(car.photo.bytes) };
    },
  };

  return { store, calls, cars };
}

function createApp(store: CarStore) {
  const app = new OpenAPIHono();
  app.route(
    "/api",
    createCarsRoute({
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

function apiPath(path: string, id?: string) {
  const resolved = id ? path.replaceAll("{id}", encodeURIComponent(id)) : path;
  return `/api${resolved}`;
}

const parkId = "park-1";
const owner = { id: "user-anna", name: "Анна" };
const worker = { id: "user-boris", name: "Борис" };

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

function jsonRequest(actor: { id: string; name: string }, membership: ParkMembership | null, body: unknown) {
  return {
    method: "POST" as const,
    headers: { ...asUser(actor, membership), "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("cars", () => {
  it("без сессии не читает и не меняет машины", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);

    const listed = await app.request(apiPath(carsPath));
    const created = await app.request(apiPath(carsPath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plate: "А123", photo: null }),
    });
    const updated = await app.request(apiPath(carPath, "car-1"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plate: "А123", photo: { state: "keep" } }),
    });
    const removed = await app.request(apiPath(carPath, "car-1"), { method: "DELETE" });
    const photo = await app.request(apiPath(carPhotoPath, "car-1"));

    expect(listed.status).toBe(401);
    expect(created.status).toBe(401);
    expect(updated.status).toBe(401);
    expect(removed.status).toBe(401);
    expect(photo.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
    expect(memory.calls).toEqual({ list: 0, create: 0, update: 0, remove: 0, readPhoto: 0 });
  });

  it("без таксопарка не читает и не меняет машины", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);
    const headers = asUser(owner, null);

    const listed = await app.request(apiPath(carsPath), { headers });
    const created = await app.request(apiPath(carsPath), jsonRequest(owner, null, { plate: "А123", photo: null }));
    const updated = await app.request(apiPath(carPath, "car-1"), {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ plate: "А123", photo: { state: "keep" } }),
    });
    const removed = await app.request(apiPath(carPath, "car-1"), { method: "DELETE", headers });
    const photo = await app.request(apiPath(carPhotoPath, "car-1"), { headers });

    expect(listed.status).toBe(403);
    expect(created.status).toBe(403);
    expect(updated.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(photo.status).toBe(403);
    expect(await listed.json()).toEqual({ error: "forbidden" });
    expect(memory.calls).toEqual({ list: 0, create: 0, update: 0, remove: 0, readPhoto: 0 });
    expect(memory.cars).toEqual([]);
  });

  it("владелец добавляет машину с номером и необязательным фото, пустой номер и не изображение не сохраняет", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);
    const headers = { ...asUser(owner), "content-type": "application/json" };

    const empty = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ plate: "   ", photo: null }),
    });
    const blank = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ plate: "", photo: null }),
    });
    const textFile = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({
        plate: "А123",
        photo: { contentType: "text/plain", data: Buffer.from("hello").toString("base64") },
      }),
    });
    const fakePng = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({
        plate: "А123",
        photo: { contentType: "image/png", data: Buffer.from("hello").toString("base64") },
      }),
    });

    expect(empty.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(textFile.status).toBe(400);
    expect(fakePng.status).toBe(400);
    expect(await fakePng.json()).toEqual({ error: "invalid" });
    expect(memory.calls.create).toBe(0);
    expect(memory.cars).toEqual([]);

    const created = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({ plate: "  А123  ", photo: null }),
    });
    expect(created.status).toBe(201);
    const car = carSchema.parse(await created.json());
    expect(car).toEqual({ id: "car-1", plate: "А123", hasPhoto: false });

    const samePlate = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({
        plate: "А123",
        photo: { contentType: "image/png", data: pngBase64 },
      }),
    });
    expect(samePlate.status).toBe(201);
    const withPhoto = carSchema.parse(await samePlate.json());
    expect(withPhoto).toEqual({ id: "car-2", plate: "А123", hasPhoto: true });

    const listed = await app.request(apiPath(carsPath), { headers: asUser(owner) });
    const body = await listed.json();
    expect(JSON.stringify(body)).not.toContain(pngBase64);
    expect(carsResponseSchema.parse(body)).toEqual({ cars: [car, withPhoto] });

    const photo = await app.request(apiPath(carPhotoPath, withPhoto.id), { headers: asUser(worker, { taxiParkId: parkId, role: "worker" }) });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await photo.arrayBuffer()).equals(pngBytes)).toBe(true);

    const missingPhoto = await app.request(apiPath(carPhotoPath, car.id), { headers: asUser(owner) });
    expect(missingPhoto.status).toBe(404);
    expect(await missingPhoto.json()).toEqual({ error: "missing" });
  });

  it("работник читает список и фото, изменение отклоняется и запись остаётся", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);
    const created = await app.request(
      apiPath(carsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, {
        plate: "А123",
        photo: { contentType: "image/png", data: pngBase64 },
      }),
    );
    const car = carSchema.parse(await created.json());
    const workerMembership = { taxiParkId: parkId, role: "worker" as const };
    const callsAfterCreate = { ...memory.calls };

    const listed = await app.request(apiPath(carsPath), { headers: asUser(worker, workerMembership) });
    expect(carsResponseSchema.parse(await listed.json()).cars).toEqual([car]);

    const deniedCreate = await app.request(
      apiPath(carsPath),
      jsonRequest(worker, workerMembership, { plate: "В456", photo: null }),
    );
    const deniedUpdate = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers: { ...asUser(worker, workerMembership), "content-type": "application/json" },
      body: JSON.stringify({ plate: "В456", photo: { state: "remove" } }),
    });
    const deniedRemove = await app.request(apiPath(carPath, car.id), {
      method: "DELETE",
      headers: asUser(worker, workerMembership),
    });

    expect(deniedCreate.status).toBe(403);
    expect(deniedUpdate.status).toBe(403);
    expect(deniedRemove.status).toBe(403);
    expect(await deniedUpdate.json()).toEqual({ error: "forbidden" });
    expect(memory.calls.create).toBe(callsAfterCreate.create);
    expect(memory.calls.update).toBe(0);
    expect(memory.calls.remove).toBe(0);

    const still = await app.request(apiPath(carsPath), { headers: asUser(owner) });
    expect(carsResponseSchema.parse(await still.json()).cars).toEqual([car]);
    const photo = await app.request(apiPath(carPhotoPath, car.id), { headers: asUser(worker, workerMembership) });
    expect(Buffer.from(await photo.arrayBuffer()).equals(pngBytes)).toBe(true);
  });

  it("чужой парк не видит машину и не меняет её", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);
    const created = await app.request(
      apiPath(carsPath),
      jsonRequest(owner, { taxiParkId: parkId, role: "owner" }, {
        plate: "А123",
        photo: { contentType: "image/png", data: pngBase64 },
      }),
    );
    const car = carSchema.parse(await created.json());
    const otherPark = { taxiParkId: "park-b", role: "owner" as const };

    const listed = await app.request(apiPath(carsPath), { headers: asUser(worker, otherPark) });
    expect(carsResponseSchema.parse(await listed.json())).toEqual({ cars: [] });

    const photo = await app.request(apiPath(carPhotoPath, car.id), { headers: asUser(worker, otherPark) });
    const updated = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers: { ...asUser(worker, otherPark), "content-type": "application/json" },
      body: JSON.stringify({ plate: "В456", photo: { state: "remove" } }),
    });
    const removed = await app.request(apiPath(carPath, car.id), {
      method: "DELETE",
      headers: asUser(worker, otherPark),
    });

    expect(photo.status).toBe(404);
    expect(updated.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(await photo.json()).toEqual({ error: "missing" });
    expect(memory.cars[0]?.plate).toBe("А123");
    expect(memory.cars[0]?.photo?.bytes.equals(pngBytes)).toBe(true);

    const own = await app.request(apiPath(carsPath), { headers: asUser(owner) });
    expect(carsResponseSchema.parse(await own.json()).cars).toEqual([car]);
  });

  it("владелец меняет номер, заменяет и убирает фото и удаляет машину", async () => {
    const memory = createMemoryStore();
    const app = createApp(memory.store);
    const headers = { ...asUser(owner), "content-type": "application/json" };
    const created = await app.request(apiPath(carsPath), {
      method: "POST",
      headers,
      body: JSON.stringify({
        plate: "А123",
        photo: { contentType: "image/png", data: pngBase64 },
      }),
    });
    const car = carSchema.parse(await created.json());

    const emptyPlate = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ plate: "  ", photo: { state: "remove" } }),
    });
    const badPhoto = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        plate: "В456",
        photo: { state: "replace", contentType: "image/png", data: Buffer.from("nope").toString("base64") },
      }),
    });
    expect(emptyPlate.status).toBe(400);
    expect(badPhoto.status).toBe(400);
    expect(memory.cars[0]?.plate).toBe("А123");
    expect(memory.cars[0]?.photo?.bytes.equals(pngBytes)).toBe(true);

    const kept = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ plate: "  В456  ", photo: { state: "keep" } }),
    });
    expect(carSchema.parse(await kept.json())).toEqual({
      id: car.id,
      plate: "В456",
      hasPhoto: true,
    });
    expect(memory.cars[0]?.photo?.bytes.equals(pngBytes)).toBe(true);

    const replaced = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        plate: "В456",
        photo: { state: "replace", contentType: "image/gif", data: gifBytes.toString("base64") },
      }),
    });
    expect(carSchema.parse(await replaced.json()).hasPhoto).toBe(true);
    const gif = await app.request(apiPath(carPhotoPath, car.id), { headers: asUser(owner) });
    expect(gif.headers.get("content-type")).toBe("image/gif");
    expect(Buffer.from(await gif.arrayBuffer()).equals(gifBytes)).toBe(true);

    const removedPhoto = await app.request(apiPath(carPath, car.id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ plate: "В456", photo: { state: "remove" } }),
    });
    expect(carSchema.parse(await removedPhoto.json())).toEqual({
      id: car.id,
      plate: "В456",
      hasPhoto: false,
    });
    const gone = await app.request(apiPath(carPhotoPath, car.id), { headers: asUser(owner) });
    expect(gone.status).toBe(404);

    const removed = await app.request(apiPath(carPath, car.id), { method: "DELETE", headers: asUser(owner) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    const listed = await app.request(apiPath(carsPath), { headers: asUser(owner) });
    expect(carsResponseSchema.parse(await listed.json())).toEqual({ cars: [] });

    const again = await app.request(apiPath(carPath, car.id), { method: "DELETE", headers: asUser(owner) });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "missing" });
  });
});
