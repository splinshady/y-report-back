import { serve } from "@hono/node-server";
import { createAuth, mountAuth } from "./auth/index.js";
import { app } from "./app.js";
import { createDb } from "./db/client.js";
import { createDrizzleScheduleStore } from "./db/schedule-store.js";
import { createDrizzleTaxiParkStore } from "./db/taxi-park-store.js";
import { createScheduleRoute } from "./routes/schedule.js";
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

const getSession = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    return null;
  }

  return { id: session.user.id, name: session.user.name };
};

const schedule = createScheduleRoute({
  store: createDrizzleScheduleStore(db),
  getSession,
  getMembership: async (headers) => {
    const actor = await getSession(headers);
    if (!actor) {
      return null;
    }

    const membership = await taxiParkStore.readMembership(actor.id);
    if (!membership) {
      return null;
    }

    return { taxiParkId: membership.taxiParkId, role: membership.role };
  },
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
