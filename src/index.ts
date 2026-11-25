import { serve } from "@hono/node-server";
import { createAuth, mountAuth } from "./auth/index.js";
import { app } from "./app.js";
import { createDb } from "./db/client.js";
import { createDrizzleScheduleStore } from "./db/schedule-store.js";
import { createScheduleRoute } from "./routes/schedule.js";

const port = 3000;
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error("BETTER_AUTH_SECRET is not set");
}

const auth = createAuth(secret);

mountAuth(app, auth);

const schedule = createScheduleRoute({
  store: createDrizzleScheduleStore(createDb()),
  getSession: async (headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      return null;
    }

    return { id: session.user.id, name: session.user.name };
  },
});

app.route("/api", schedule);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Listening on ${info.port}`);
  },
);
