import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createDb } from "./client.js";
import {
  scheduleRequest,
  scheduleRequestDay,
  user,
} from "./schema.js";
import type {
  ScheduleActor,
  ScheduleDay,
  ScheduleRequestRecord,
  ScheduleRequestStatus,
  ScheduleShift,
  ScheduleStore,
} from "./schedule-types.js";

type Database = ReturnType<typeof createDb>;

const approver = alias(user, "approver");
const rejector = alias(user, "rejector");

function isScheduleStatus(value: string): value is ScheduleRequestStatus {
  return value === "requested" || value === "approved" || value === "rejected";
}

function isScheduleShift(value: string): value is ScheduleShift {
  return value === "day" || value === "night";
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

function groupRows(
  rows: Array<{
    id: string;
    taxiParkId: string;
    status: string;
    createdById: string;
    createdByName: string;
    approvedById: string | null;
    approvedByName: string | null;
    rejectedById: string | null;
    rejectedByName: string | null;
    workDate: string;
    shift: string;
  }>,
): ScheduleRequestRecord[] {
  const grouped = new Map<string, ScheduleRequestRecord>();

  for (const row of rows) {
    if (!isScheduleStatus(row.status) || !isScheduleShift(row.shift)) {
      throw new Error("Stored schedule request is invalid");
    }

    let request = grouped.get(row.id);
    if (!request) {
      request = {
        id: row.id,
        taxiParkId: row.taxiParkId,
        status: row.status,
        createdBy: { id: row.createdById, name: row.createdByName },
        approvedBy:
          row.approvedById && row.approvedByName
            ? { id: row.approvedById, name: row.approvedByName }
            : null,
        rejectedBy:
          row.rejectedById && row.rejectedByName
            ? { id: row.rejectedById, name: row.rejectedByName }
            : null,
        days: [],
      };
      grouped.set(row.id, request);
    }

    request.days.push({ date: row.workDate, shift: row.shift });
  }

  return [...grouped.values()];
}

async function readRequests(db: Database, taxiParkId: string): Promise<ScheduleRequestRecord[]> {
  const rows = await db
    .select({
      id: scheduleRequest.id,
      taxiParkId: scheduleRequest.taxiParkId,
      status: scheduleRequest.status,
      createdById: user.id,
      createdByName: user.name,
      approvedById: approver.id,
      approvedByName: approver.name,
      rejectedById: rejector.id,
      rejectedByName: rejector.name,
      workDate: scheduleRequestDay.workDate,
      shift: scheduleRequestDay.shift,
    })
    .from(scheduleRequest)
    .innerJoin(scheduleRequestDay, eq(scheduleRequestDay.requestId, scheduleRequest.id))
    .innerJoin(user, eq(user.id, scheduleRequest.createdByUserId))
    .leftJoin(approver, eq(approver.id, scheduleRequest.approvedByUserId))
    .leftJoin(rejector, eq(rejector.id, scheduleRequest.rejectedByUserId))
    .where(eq(scheduleRequest.taxiParkId, taxiParkId))
    .orderBy(asc(scheduleRequest.createdAt), asc(scheduleRequestDay.workDate));

  return groupRows(rows);
}

export function createDrizzleScheduleStore(db: Database): ScheduleStore {
  return {
    async list(taxiParkId) {
      return readRequests(db, taxiParkId);
    },

    async create(taxiParkId, actor: ScheduleActor, days: ScheduleDay[]) {
      const dates = days.map((day) => day.date);
      const taken = await db
        .select({ workDate: scheduleRequestDay.workDate })
        .from(scheduleRequestDay)
        .where(
          and(
            eq(scheduleRequestDay.taxiParkId, taxiParkId),
            eq(scheduleRequestDay.reserved, true),
            inArray(scheduleRequestDay.workDate, dates),
          ),
        );

      if (taken.length > 0) {
        return "conflict";
      }

      const requestId = crypto.randomUUID();

      try {
        await db.transaction(async (tx) => {
          await tx.insert(scheduleRequest).values({
            id: requestId,
            taxiParkId,
            createdByUserId: actor.id,
            status: "requested",
          });
          await tx.insert(scheduleRequestDay).values(
            days.map((day) => ({
              id: crypto.randomUUID(),
              requestId,
              taxiParkId,
              workDate: day.date,
              shift: day.shift,
            })),
          );
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "conflict";
        }
        throw error;
      }

      const created = (await readRequests(db, taxiParkId)).find((request) => request.id === requestId);
      if (!created) {
        throw new Error("Schedule request was not stored");
      }

      return created;
    },

    async approve(taxiParkId, actor: ScheduleActor, requestId: string) {
      const existing = await db
        .select({ id: scheduleRequest.id, status: scheduleRequest.status })
        .from(scheduleRequest)
        .where(
          and(eq(scheduleRequest.id, requestId), eq(scheduleRequest.taxiParkId, taxiParkId)),
        );

      const current = existing[0];
      if (!current) {
        return "missing";
      }
      if (current.status !== "requested") {
        return "none";
      }

      await db
        .update(scheduleRequest)
        .set({
          status: "approved",
          approvedByUserId: actor.id,
          approvedAt: new Date(),
        })
        .where(eq(scheduleRequest.id, requestId));

      const updated = (await readRequests(db, taxiParkId)).find((request) => request.id === requestId);
      if (!updated) {
        return "missing";
      }

      return updated;
    },

    async reject(taxiParkId, actor: ScheduleActor, requestId: string) {
      const existing = await db
        .select({ id: scheduleRequest.id, status: scheduleRequest.status })
        .from(scheduleRequest)
        .where(
          and(eq(scheduleRequest.id, requestId), eq(scheduleRequest.taxiParkId, taxiParkId)),
        );

      const current = existing[0];
      if (!current) {
        return "missing";
      }
      if (current.status === "rejected") {
        return "none";
      }

      await db.transaction(async (tx) => {
        await tx
          .update(scheduleRequest)
          .set({
            status: "rejected",
            rejectedByUserId: actor.id,
            rejectedAt: new Date(),
          })
          .where(eq(scheduleRequest.id, requestId));
        await tx
          .update(scheduleRequestDay)
          .set({ reserved: false })
          .where(eq(scheduleRequestDay.requestId, requestId));
      });

      const updated = (await readRequests(db, taxiParkId)).find((request) => request.id === requestId);
      if (!updated) {
        return "missing";
      }

      return updated;
    },

    async remove(taxiParkId, requestId: string) {
      const existing = await db
        .select({ id: scheduleRequest.id })
        .from(scheduleRequest)
        .where(
          and(eq(scheduleRequest.id, requestId), eq(scheduleRequest.taxiParkId, taxiParkId)),
        );

      if (existing.length === 0) {
        return "missing";
      }

      await db.delete(scheduleRequest).where(eq(scheduleRequest.id, requestId));
      return "deleted";
    },
  };
}
