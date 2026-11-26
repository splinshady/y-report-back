import { and, asc, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { car, scheduleRequest, scheduleRequestDay } from "./schema.js";

type Database = ReturnType<typeof createDb>;

export type CarPhoto = {
  contentType: string;
  bytes: Buffer;
};

export type CarSummary = {
  id: string;
  plate: string;
  hasPhoto: boolean;
};

export type CarPhotoChange =
  | { state: "keep" }
  | { state: "remove" }
  | { state: "replace"; photo: CarPhoto };

export type CarStore = {
  list: (taxiParkId: string) => Promise<CarSummary[]>;
  read: (taxiParkId: string, carId: string) => Promise<CarSummary | null>;
  create: (taxiParkId: string, plate: string, photo: CarPhoto | null) => Promise<CarSummary>;
  update: (
    taxiParkId: string,
    carId: string,
    plate: string,
    photo: CarPhotoChange,
  ) => Promise<CarSummary | "missing">;
  remove: (taxiParkId: string, carId: string) => Promise<"missing" | "deleted">;
  readPhoto: (taxiParkId: string, carId: string) => Promise<CarPhoto | "missing" | "none">;
};

function summary(row: { id: string; plate: string; photoContentType: string | null }): CarSummary {
  return {
    id: row.id,
    plate: row.plate,
    hasPhoto: row.photoContentType != null,
  };
}

export function createDrizzleCarStore(db: Database): CarStore {
  return {
    async list(taxiParkId) {
      const rows = await db
        .select({
          id: car.id,
          plate: car.plate,
          photoContentType: car.photoContentType,
        })
        .from(car)
        .where(eq(car.taxiParkId, taxiParkId))
        .orderBy(asc(car.createdAt), asc(car.plate));

      return rows.map(summary);
    },

    async read(taxiParkId, carId) {
      const rows = await db
        .select({
          id: car.id,
          plate: car.plate,
          photoContentType: car.photoContentType,
        })
        .from(car)
        .where(and(eq(car.id, carId), eq(car.taxiParkId, taxiParkId)))
        .limit(1);

      const row = rows[0];
      return row ? summary(row) : null;
    },

    async create(taxiParkId, plate, photo) {
      const id = crypto.randomUUID();
      const rows = await db
        .insert(car)
        .values({
          id,
          taxiParkId,
          plate,
          photo: photo?.bytes ?? null,
          photoContentType: photo?.contentType ?? null,
        })
        .returning({
          id: car.id,
          plate: car.plate,
          photoContentType: car.photoContentType,
        });

      const row = rows[0];
      if (!row) {
        throw new Error("Car was not stored");
      }

      return summary(row);
    },

    async update(taxiParkId, carId, plate, photo) {
      const patch =
        photo.state === "keep"
          ? { plate }
          : photo.state === "remove"
            ? { plate, photo: null, photoContentType: null }
            : { plate, photo: photo.photo.bytes, photoContentType: photo.photo.contentType };

      const rows = await db
        .update(car)
        .set(patch)
        .where(and(eq(car.id, carId), eq(car.taxiParkId, taxiParkId)))
        .returning({
          id: car.id,
          plate: car.plate,
          photoContentType: car.photoContentType,
        });

      const row = rows[0];
      return row ? summary(row) : "missing";
    },

    async remove(taxiParkId, carId) {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: car.id })
          .from(car)
          .where(and(eq(car.id, carId), eq(car.taxiParkId, taxiParkId)))
          .limit(1);

        if (!existing[0]) {
          return "missing";
        }

        await tx.delete(scheduleRequestDay).where(eq(scheduleRequestDay.carId, carId));
        await tx
          .delete(scheduleRequest)
          .where(and(eq(scheduleRequest.carId, carId), eq(scheduleRequest.taxiParkId, taxiParkId)));
        await tx.delete(car).where(and(eq(car.id, carId), eq(car.taxiParkId, taxiParkId)));
        return "deleted";
      });
    },

    async readPhoto(taxiParkId, carId) {
      const rows = await db
        .select({
          photo: car.photo,
          photoContentType: car.photoContentType,
        })
        .from(car)
        .where(and(eq(car.id, carId), eq(car.taxiParkId, taxiParkId)))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return "missing";
      }
      if (!row.photo || !row.photoContentType) {
        return "none";
      }

      return { contentType: row.photoContentType, bytes: row.photo };
    },
  };
}
