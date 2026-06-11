import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { env } from "./config/env.js";
import { loadRuntimeConfig } from "./config/runtime.js";
import { ok } from "./http/envelope.js";
import { registerAuth } from "./plugins/auth.js";
import { registerConfig } from "./plugins/config.js";
import { registerErrors } from "./plugins/errors.js";
import { registerInfra } from "./plugins/infra.js";
import { registerObservability } from "./plugins/observability.js";
import { createRequestId } from "./observability/ids.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAchievementRoutes } from "./routes/achievements.js";
import { registerBeanRoutes } from "./routes/beans.js";
import { registerCheckInRoutes } from "./routes/checkins.js";
import { registerLeaderboardRoutes } from "./routes/leaderboards.js";

const runtimeConfig = await loadRuntimeConfig();

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.authorization", "authorization", "*.token", "*.otp"],
      censor: "[redacted]"
    }
  },
  genReqId: (request) => request.headers["x-request-id"]?.toString() ?? createRequestId()
});

await server.register(cors, {
  origin: true
});

await server.register(sensible);
await registerConfig(server, runtimeConfig);
await registerObservability(server);
await registerErrors(server);
await registerInfra(server);
await registerAuth(server);

await server.register(rateLimit, {
  max: runtimeConfig.rateLimits.global.max,
  timeWindow: runtimeConfig.rateLimits.global.timeWindow,
  errorResponseBuilder: (request, context) =>
    ({
      data: null,
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded, retry in ${context.after}`,
        requestId: request.trace.requestId,
        traceId: request.trace.traceId
      }
    }) as object
});

await server.register(registerAuthRoutes);
await server.register(registerCheckInRoutes);
await server.register(registerLeaderboardRoutes);
await server.register(registerBeanRoutes);
await server.register(registerAchievementRoutes);

server.get("/health", async (request) => {
  return ok({
    ok: true,
    service: "slack-off-api",
    configSource: env.CONFIG_SOURCE,
    requestId: request.trace.requestId,
    traceId: request.trace.traceId
  });
});

await server.listen({ port: env.PORT, host: env.HOST });
