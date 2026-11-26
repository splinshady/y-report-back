import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const scheduleRequest = pgTable(
  "schedule_request",
  {
    id: text("id").primaryKey(),
    taxiParkId: text("taxi_park_id")
      .notNull()
      .references(() => taxiPark.id),
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
    workDate: text("work_date").notNull(),
    shift: text("shift").notNull(),
    reserved: boolean("reserved").notNull().default(true),
  },
  (table) => [
    index("schedule_request_day_request_id_idx").on(table.requestId),
    uniqueIndex("schedule_request_day_park_date_idx")
      .on(table.taxiParkId, table.workDate)
      .where(sql`${table.reserved} = true`),
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
  scheduleRequests: many(scheduleRequest),
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

export const scheduleRequestDayRelations = relations(scheduleRequestDay, ({ one }) => ({
  request: one(scheduleRequest, {
    fields: [scheduleRequestDay.requestId],
    references: [scheduleRequest.id],
  }),
  taxiPark: one(taxiPark, {
    fields: [scheduleRequestDay.taxiParkId],
    references: [taxiPark.id],
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
