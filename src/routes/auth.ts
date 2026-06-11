import type { FastifyInstance } from "fastify";
import { ok } from "../http/envelope.js";

export async function registerAuthRoutes(server: FastifyInstance) {
  server.get(
    "/v1/auth/me",
    {
      preHandler: [server.requireAuth],
      schema: {
        response: {
          200: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: {
                type: "object",
                required: ["id", "email", "displayName"],
                properties: {
                  id: { type: "string" },
                  email: { type: ["string", "null"] },
                  displayName: { type: "string" }
                }
              },
              error: { type: "null" }
            }
          }
        }
      }
    },
    async (request) => {
      return ok({
        id: request.user?.id,
        email: request.user?.email ?? null,
        displayName: request.user?.displayName ?? "摸鱼新同学"
      });
    }
  );
}
