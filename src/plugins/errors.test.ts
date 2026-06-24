import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerObservability } from "./observability.js";
import { registerErrors } from "./errors.js";

describe("error handling", () => {
  it("preserves envelope error codes from plugins such as rate limiting", async () => {
    const server = Fastify({ logger: false });
    await registerObservability(server);
    await registerErrors(server);
    server.get("/limited", async () => {
      throw {
        data: null,
        error: {
          code: "RATE_LIMITED",
          message: "Rate limit exceeded, retry in 42 seconds"
        }
      };
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/limited" });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      data: null,
      error: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded, retry in 42 seconds"
      }
    });

    await server.close();
  });
});
