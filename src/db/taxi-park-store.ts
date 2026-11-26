import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { taxiPark, taxiParkMember, user } from "./schema.js";

type Database = ReturnType<typeof createDb>;

export type TaxiParkRole = "owner" | "worker";

export type TaxiParkMembership = {
  taxiParkId: string;
  name: string;
  role: TaxiParkRole;
};

export type TaxiParkStore = {
  readMembership: (userId: string) => Promise<TaxiParkMembership | null>;
  createPark: (userId: string, name: string) => Promise<TaxiParkMembership | "conflict">;
  inviteWorker: (
    actorUserId: string,
    workerUserId: string,
  ) => Promise<TaxiParkMembership | "forbidden" | "missing" | "conflict">;
};

function isTaxiParkRole(value: string): value is TaxiParkRole {
  return value === "owner" || value === "worker";
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }

  return false;
}

async function readMembership(db: Database, userId: string): Promise<TaxiParkMembership | null> {
  const rows = await db
    .select({
      taxiParkId: taxiPark.id,
      name: taxiPark.name,
      role: taxiParkMember.role,
    })
    .from(taxiParkMember)
    .innerJoin(taxiPark, eq(taxiPark.id, taxiParkMember.taxiParkId))
    .where(eq(taxiParkMember.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  if (!isTaxiParkRole(row.role)) {
    throw new Error("Stored taxi park membership is invalid");
  }

  return { taxiParkId: row.taxiParkId, name: row.name, role: row.role };
}

export function createDrizzleTaxiParkStore(db: Database): TaxiParkStore {
  return {
    readMembership(userId) {
      return readMembership(db, userId);
    },

    async createPark(userId, name) {
      const existing = await readMembership(db, userId);
      if (existing) {
        return "conflict";
      }

      const taxiParkId = crypto.randomUUID();

      try {
        await db.transaction(async (tx) => {
          await tx.insert(taxiPark).values({ id: taxiParkId, name });
          await tx.insert(taxiParkMember).values({
            id: crypto.randomUUID(),
            taxiParkId,
            userId,
            role: "owner",
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "conflict";
        }
        throw error;
      }

      return { taxiParkId, name, role: "owner" };
    },

    async inviteWorker(actorUserId, workerUserId) {
      const actor = await readMembership(db, actorUserId);
      if (!actor || actor.role !== "owner") {
        return "forbidden";
      }

      const known = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, workerUserId))
        .limit(1);
      if (known.length === 0) {
        return "missing";
      }

      const existing = await readMembership(db, workerUserId);
      if (existing) {
        return "conflict";
      }

      try {
        await db.insert(taxiParkMember).values({
          id: crypto.randomUUID(),
          taxiParkId: actor.taxiParkId,
          userId: workerUserId,
          role: "worker",
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "conflict";
        }
        throw error;
      }

      return { taxiParkId: actor.taxiParkId, name: actor.name, role: "worker" };
    },
  };
}
