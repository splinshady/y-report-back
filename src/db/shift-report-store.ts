import { and, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { scheduleRequest, scheduleRequestDay, shiftReport } from "./schema.js";
import type {
  ShiftReportDraft,
  ShiftReportPhoto,
  ShiftReportRecord,
  ShiftReportShift,
  ShiftReportSlot,
  ShiftReportStore,
} from "./shift-report-types.js";

type Database = ReturnType<typeof createDb>;

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

function isShift(value: string): value is ShiftReportShift {
  return value === "day" || value === "night";
}

function recordFromRow(row: {
  id: string;
  carId: string;
  workDate: string;
  shift: string;
  mileageStart: number;
  mileageEnd: number;
  cashless: number;
  cash: number;
  discount: number;
  tip: number;
  wash: number;
  lineTime: number;
  cashStart: number;
  cashEnd: number;
  shiftTotal: number;
}): ShiftReportRecord {
  if (!isShift(row.shift)) {
    throw new Error("Stored shift report is invalid");
  }

  return {
    id: row.id,
    carId: row.carId,
    date: row.workDate,
    shift: row.shift,
    mileageStart: row.mileageStart,
    mileageEnd: row.mileageEnd,
    cashless: row.cashless,
    cash: row.cash,
    discount: row.discount,
    tip: row.tip,
    wash: row.wash,
    lineTime: row.lineTime,
    cashStart: row.cashStart,
    cashEnd: row.cashEnd,
    shiftTotal: row.shiftTotal,
  };
}

const reportColumns = {
  id: shiftReport.id,
  carId: shiftReport.carId,
  workDate: shiftReport.workDate,
  shift: shiftReport.shift,
  mileageStart: shiftReport.mileageStart,
  mileageEnd: shiftReport.mileageEnd,
  cashless: shiftReport.cashless,
  cash: shiftReport.cash,
  discount: shiftReport.discount,
  tip: shiftReport.tip,
  wash: shiftReport.wash,
  lineTime: shiftReport.lineTime,
  cashStart: shiftReport.cashStart,
  cashEnd: shiftReport.cashEnd,
  shiftTotal: shiftReport.shiftTotal,
};

async function readReport(
  db: Database,
  taxiParkId: string,
  carId: string,
  date: string,
  shift: ShiftReportShift,
): Promise<ShiftReportRecord | null> {
  const rows = await db
    .select(reportColumns)
    .from(shiftReport)
    .where(
      and(
        eq(shiftReport.taxiParkId, taxiParkId),
        eq(shiftReport.carId, carId),
        eq(shiftReport.workDate, date),
        eq(shiftReport.shift, shift),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? recordFromRow(row) : null;
}

function photoFromRow(
  row: {
    photo1: Buffer;
    photo1ContentType: string;
    photo2: Buffer;
    photo2ContentType: string;
    photo3: Buffer;
    photo3ContentType: string;
    photo4: Buffer;
    photo4ContentType: string;
  },
  slot: ShiftReportSlot,
): ShiftReportPhoto {
  if (slot === 1) {
    return { contentType: row.photo1ContentType, bytes: row.photo1 };
  }
  if (slot === 2) {
    return { contentType: row.photo2ContentType, bytes: row.photo2 };
  }
  if (slot === 3) {
    return { contentType: row.photo3ContentType, bytes: row.photo3 };
  }

  return { contentType: row.photo4ContentType, bytes: row.photo4 };
}

export async function hasApprovedShift(
  db: Database,
  taxiParkId: string,
  carId: string,
  date: string,
  shift: ShiftReportShift,
): Promise<boolean> {
  const rows = await db
    .select({ id: scheduleRequestDay.id })
    .from(scheduleRequestDay)
    .innerJoin(scheduleRequest, eq(scheduleRequest.id, scheduleRequestDay.requestId))
    .where(
      and(
        eq(scheduleRequest.taxiParkId, taxiParkId),
        eq(scheduleRequest.carId, carId),
        eq(scheduleRequest.status, "approved"),
        eq(scheduleRequestDay.workDate, date),
        eq(scheduleRequestDay.shift, shift),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export function createDrizzleShiftReportStore(db: Database): ShiftReportStore {
  return {
    async create(taxiParkId, draft: ShiftReportDraft) {
      const id = crypto.randomUUID();
      const [first, second, third, fourth] = draft.photos;

      try {
        await db.insert(shiftReport).values({
          id,
          taxiParkId,
          carId: draft.carId,
          workDate: draft.date,
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
          photo1: first.bytes,
          photo1ContentType: first.contentType,
          photo2: second.bytes,
          photo2ContentType: second.contentType,
          photo3: third.bytes,
          photo3ContentType: third.contentType,
          photo4: fourth.bytes,
          photo4ContentType: fourth.contentType,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "conflict";
        }
        throw error;
      }

      const created = await readReport(db, taxiParkId, draft.carId, draft.date, draft.shift);
      if (!created) {
        throw new Error("Shift report was not stored");
      }

      return created;
    },

    read(taxiParkId, carId, date, shift) {
      return readReport(db, taxiParkId, carId, date, shift);
    },

    async readPhoto(taxiParkId, reportId, slot) {
      const rows = await db
        .select({
          photo1: shiftReport.photo1,
          photo1ContentType: shiftReport.photo1ContentType,
          photo2: shiftReport.photo2,
          photo2ContentType: shiftReport.photo2ContentType,
          photo3: shiftReport.photo3,
          photo3ContentType: shiftReport.photo3ContentType,
          photo4: shiftReport.photo4,
          photo4ContentType: shiftReport.photo4ContentType,
        })
        .from(shiftReport)
        .where(and(eq(shiftReport.id, reportId), eq(shiftReport.taxiParkId, taxiParkId)))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return "missing";
      }

      return photoFromRow(row, slot);
    },
  };
}
