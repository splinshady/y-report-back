import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const taxiPark = pgTable("taxi_park", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const taxiParkMember = pgTable(
  "taxi_park_member",
  {
    id: text("id").primaryKey(),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("taxi_park_member_user_id_idx").on(table.userId),
    check("taxi_park_member_role_check", sql`${table.role} in ('owner', 'worker')`),
  ],
);

export const car = pgTable(
  "car",
  {
    id: text("id").primaryKey(),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
    plate: text("plate").notNull(),
    photo: bytea("photo"),
    photoContentType: text("photo_content_type"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("car_taxi_park_id_idx").on(table.taxiParkId)],
);

export const scheduleRequest = pgTable(
  "schedule_request",
  {
    id: text("id").primaryKey(),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
    carId: text("car_id")
      .notNull()
      .references(() => car.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    approvedByUserId: text("approved_by_user_id").references(() => user.id),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    approvedAt: timestamp("approved_at"),
    rejectedByUserId: text("rejected_by_user_id").references(() => user.id),
    rejectedAt: timestamp("rejected_at"),
  },
  (table) => [
    index("schedule_request_taxi_park_id_idx").on(table.taxiParkId),
    index("schedule_request_car_id_idx").on(table.carId),
    index("schedule_request_created_by_user_id_idx").on(table.createdByUserId),
  ],
);

export const scheduleRequestDay = pgTable(
  "schedule_request_day",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => scheduleRequest.id, { onDelete: "cascade" }),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
    carId: text("car_id")
      .notNull()
      .references(() => car.id, { onDelete: "cascade" }),
    workDate: text("work_date").notNull(),
    shift: text("shift").notNull(),
    reserved: boolean("reserved").notNull().default(true),
  },
  (table) => [
    index("schedule_request_day_request_id_idx").on(table.requestId),
    uniqueIndex("schedule_request_day_car_date_idx")
      .on(table.carId, table.workDate)
      .where(sql`${table.reserved} = true`),
  ],
);

export const shiftReport = pgTable(
  "shift_report",
  {
    id: text("id").primaryKey(),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
    carId: text("car_id")
      .notNull()
      .references(() => car.id, { onDelete: "cascade" }),
    workDate: text("work_date").notNull(),
    shift: text("shift").notNull(),
    mileageStart: doublePrecision("mileage_start").notNull(),
    mileageEnd: doublePrecision("mileage_end").notNull(),
    cashless: doublePrecision("cashless").notNull(),
    cash: doublePrecision("cash").notNull(),
    discount: doublePrecision("discount").notNull(),
    tip: doublePrecision("tip").notNull(),
    wash: doublePrecision("wash").notNull(),
    lineTime: doublePrecision("line_time").notNull(),
    cashStart: doublePrecision("cash_start").notNull(),
    cashEnd: doublePrecision("cash_end").notNull(),
    shiftTotal: doublePrecision("shift_total").notNull(),
    photo1: bytea("photo_1").notNull(),
    photo1ContentType: text("photo_1_content_type").notNull(),
    photo2: bytea("photo_2").notNull(),
    photo2ContentType: text("photo_2_content_type").notNull(),
    photo3: bytea("photo_3").notNull(),
    photo3ContentType: text("photo_3_content_type").notNull(),
    photo4: bytea("photo_4").notNull(),
    photo4ContentType: text("photo_4_content_type").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("shift_report_taxi_park_id_idx").on(table.taxiParkId),
    uniqueIndex("shift_report_car_date_shift_idx").on(table.carId, table.workDate, table.shift),
    check("shift_report_shift_check", sql`${table.shift} in ('day', 'night')`),
  ],
);

export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  taxiParkMember: one(taxiParkMember, {
    fields: [user.id],
    references: [taxiParkMember.userId],
  }),
  createdScheduleRequests: many(scheduleRequest, { relationName: "scheduleRequestCreator" }),
  approvedScheduleRequests: many(scheduleRequest, { relationName: "scheduleRequestApprover" }),
}));

export const taxiParkRelations = relations(taxiPark, ({ many }) => ({
  members: many(taxiParkMember),
  cars: many(car),
  scheduleRequests: many(scheduleRequest),
  shiftReports: many(shiftReport),
}));

export const carRelations = relations(car, ({ one, many }) => ({
  taxiPark: one(taxiPark, {
    fields: [car.taxiParkId],
    references: [taxiPark.id],
  }),
  scheduleRequests: many(scheduleRequest),
  shiftReports: many(shiftReport),
}));

export const taxiParkMemberRelations = relations(taxiParkMember, ({ one }) => ({
  taxiPark: one(taxiPark, {
    fields: [taxiParkMember.taxiParkId],
    references: [taxiPark.id],
  }),
  user: one(user, {
    fields: [taxiParkMember.userId],
    references: [user.id],
  }),
}));

export const scheduleRequestRelations = relations(scheduleRequest, ({ one, many }) => ({
  taxiPark: one(taxiPark, {
    fields: [scheduleRequest.taxiParkId],
    references: [taxiPark.id],
  }),
  car: one(car, {
    fields: [scheduleRequest.carId],
    references: [car.id],
  }),
  createdBy: one(user, {
    fields: [scheduleRequest.createdByUserId],
    references: [user.id],
    relationName: "scheduleRequestCreator",
  }),
  approvedBy: one(user, {
    fields: [scheduleRequest.approvedByUserId],
    references: [user.id],
    relationName: "scheduleRequestApprover",
  }),
  days: many(scheduleRequestDay),
}));

export const shiftReportRelations = relations(shiftReport, ({ one }) => ({
  taxiPark: one(taxiPark, {
    fields: [shiftReport.taxiParkId],
    references: [taxiPark.id],
  }),
  car: one(car, {
    fields: [shiftReport.carId],
    references: [car.id],
  }),
}));

export const scheduleRequestDayRelations = relations(scheduleRequestDay, ({ one }) => ({
  request: one(scheduleRequest, {
    fields: [scheduleRequestDay.requestId],
    references: [scheduleRequest.id],
  }),
  taxiPark: one(taxiPark, {
    fields: [scheduleRequestDay.taxiParkId],
    references: [taxiPark.id],
  }),
  car: one(car, {
    fields: [scheduleRequestDay.carId],
    references: [car.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
