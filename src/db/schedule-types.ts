export type ScheduleShift = "day" | "night";

export type ScheduleRequestStatus = "requested" | "approved" | "rejected";

export type ScheduleActor = {
  id: string;
  name: string;
};

export type ScheduleDay = {
  date: string;
  shift: ScheduleShift;
};

export type ScheduleRequestRecord = {
  id: string;
  taxiParkId: string;
  status: ScheduleRequestStatus;
  createdBy: ScheduleActor;
  approvedBy: ScheduleActor | null;
  rejectedBy: ScheduleActor | null;
  days: ScheduleDay[];
};

export type ScheduleStore = {
  list: (taxiParkId: string) => Promise<ScheduleRequestRecord[]>;
  create: (
    taxiParkId: string,
    actor: ScheduleActor,
    days: ScheduleDay[],
  ) => Promise<ScheduleRequestRecord | "conflict">;
  approve: (
    taxiParkId: string,
    actor: ScheduleActor,
    requestId: string,
  ) => Promise<ScheduleRequestRecord | "missing" | "none">;
  reject: (
    taxiParkId: string,
    actor: ScheduleActor,
    requestId: string,
  ) => Promise<ScheduleRequestRecord | "missing" | "none">;
  remove: (taxiParkId: string, requestId: string) => Promise<"missing" | "deleted">;
};
