import { Redis } from "ioredis";
import { env } from "../config/env.js";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }

  redis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true
  });

  return redis;
}

export async function closeRedis(): Promise<void> {
  if (!redis) {
    return;
  }

  redis.disconnect();
  redis = null;
}
