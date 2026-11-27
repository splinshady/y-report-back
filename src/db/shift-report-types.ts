export type ShiftReportShift = "day" | "night";

export type ShiftReportSlot = 1 | 2 | 3 | 4;

export type ShiftReportPhoto = {
  contentType: string;
  bytes: Buffer;
};

export type ShiftReportNumbers = {
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
};

export type ShiftReportRecord = ShiftReportNumbers & {
  id: string;
  carId: string;
  date: string;
  shift: ShiftReportShift;
};

export type ShiftReportDraft = ShiftReportNumbers & {
  carId: string;
  date: string;
  shift: ShiftReportShift;
  photos: [ShiftReportPhoto, ShiftReportPhoto, ShiftReportPhoto, ShiftReportPhoto];
};

export type ShiftReportStore = {
  create: (taxiParkId: string, draft: ShiftReportDraft) => Promise<ShiftReportRecord | "conflict">;
  list: (taxiParkId: string, carId: string) => Promise<ShiftReportRecord[]>;
  readById: (taxiParkId: string, reportId: string) => Promise<ShiftReportRecord | null>;
  read: (
    taxiParkId: string,
    carId: string,
    date: string,
    shift: ShiftReportShift,
  ) => Promise<ShiftReportRecord | null>;
  readPhoto: (
    taxiParkId: string,
    reportId: string,
    slot: ShiftReportSlot,
  ) => Promise<ShiftReportPhoto | "missing">;
};
