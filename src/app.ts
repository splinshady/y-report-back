import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoute } from "./routes/health.js";

export const app = new OpenAPIHono();

app.route("/api", healthRoute);

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "y-report",
    version: "1.0.0",
  },
});

app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
