import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const getHealthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      description: "Сервис доступен",
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
    },
  },
});

export const healthRoute = new OpenAPIHono();

healthRoute.openapi(getHealthRoute, (c) => {
  const body = healthResponseSchema.parse({ ok: true });
  return c.json(body, 200);
});
