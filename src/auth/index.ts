import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, yandex } from "better-auth/plugins/generic-oauth";
import type { Context } from "hono";
import { createDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const authSchema = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
};

type AuthHandler = {
  handler: (request: Request) => Response | Promise<Response>;
};

type AuthApp = {
  on: (
    methods: string[],
    path: string,
    handler: (context: Context) => Response | Promise<Response>,
  ) => void;
};

function readYandexCredentials() {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET are not set");
  }

  return { clientId, clientSecret };
}

export function createAuth(secret: string) {
  const { clientId, clientSecret } = readYandexCredentials();

  return betterAuth({
    secret,
    baseURL: "http://127.0.0.1:5173",
    basePath: "/api/auth",
    database: drizzleAdapter(createDb(), {
      provider: "pg",
      schema: authSchema,
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      genericOAuth({
        config: [
          yandex({
            clientId,
            clientSecret,
          }),
        ],
      }),
    ],
  });
}

export function mountAuth(app: AuthApp, auth: AuthHandler) {
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw));
}
