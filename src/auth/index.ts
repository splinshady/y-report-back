import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const authSchema = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
};

export function createAuth(secret: string) {
  return betterAuth({
    secret,
    database: drizzleAdapter(createDb(), {
      provider: "pg",
      schema: authSchema,
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });
}
