import type { FastifyInstance, RouteOptions } from "fastify";
import type { RateLimitPolicy } from "../config/runtime.js";

export type RateLimitBucket =
  | "otp"
  | "checkIns"
  | "activities"
  | "beanDraws"
  | "leaderboardReads"
  | "profileUpdates"
  | "fishTank";

export function rateLimitFor(
  server: FastifyInstance,
  bucket: RateLimitBucket
): Pick<RouteOptions, "config"> {
  const policy = server.runtimeConfig.rateLimits[bucket] satisfies RateLimitPolicy;
  return {
    config: {
      rateLimit: {
        max: policy.max,
        timeWindow: policy.timeWindow,
        keyGenerator: (request) => request.user?.id ?? request.ip
      }
    }
  };
}
