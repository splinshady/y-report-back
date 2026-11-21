import { serve } from "@hono/node-server";
import { createAuth } from "./auth/index.js";
import { app } from "./app.js";

const port = 3000;
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret) {
  throw new Error("BETTER_AUTH_SECRET is not set");
}

export const auth = createAuth(secret);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Listening on ${info.port}`);
  },
);
