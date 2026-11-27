import { serve } from "@hono/node-server";
import { createAuth, mountAuth } from "./auth/index.js";
import { app } from "./app.js";
import { createDrizzleCarStore } from "./db/car-store.js";
import { createDb } from "./db/client.js";
import { createDrizzleScheduleStore } from "./db/schedule-store.js";
import { createDrizzleShiftReportStore, hasApprovedShift } from "./db/shift-report-store.js";
import { createDrizzleTaxiParkStore } from "./db/taxi-park-store.js";
import { createCarsRoute } from "./routes/cars.js";
import { createScheduleRoute } from "./routes/schedule.js";
import { createShiftReportRoute } from "./routes/shift-report.js";
import { createTaxiParkRoute } from "./routes/taxi-park.js";

const port = 3000;
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error("BETTER_AUTH_SECRET is not set");
}

const auth = createAuth(secret);

mountAuth(app, auth);

const db = createDb();
const taxiParkStore = createDrizzleTaxiParkStore(db);
const carStore = createDrizzleCarStore(db);

const getSession = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    return null;
  }

  return { id: session.user.id, name: session.user.name };
};

const getMembership = async (headers: Headers) => {
  const actor = await getSession(headers);
  if (!actor) {
    return null;
  }

  const membership = await taxiParkStore.readMembership(actor.id);
  if (!membership) {
    return null;
  }

  return { taxiParkId: membership.taxiParkId, role: membership.role };
};

const schedule = createScheduleRoute({
  store: createDrizzleScheduleStore(db),
  findCar: (taxiParkId, carId) => carStore.read(taxiParkId, carId),
  getSession,
  getMembership,
});

const cars = createCarsRoute({
  store: carStore,
  getSession,
  getMembership,
});

const shiftReports = createShiftReportRoute({
  store: createDrizzleShiftReportStore(db),
  findCar: (taxiParkId, carId) => carStore.read(taxiParkId, carId),
  hasApprovedShift: (taxiParkId, carId, date, shift) =>
    hasApprovedShift(db, taxiParkId, carId, date, shift),
  getSession,
  getMembership,
  today: () => new Date(),
});

const taxiPark = createTaxiParkRoute({
  store: taxiParkStore,
  getSession: async (headers) => {
    const actor = await getSession(headers);
    if (!actor) {
      return null;
    }

    return { id: actor.id };
  },
});

app.route("/api", schedule);
app.route("/api", cars);
app.route("/api", shiftReports);
app.route("/api", taxiPark);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Listening on ${info.port}`);
  },
);
