import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { getRedis, closeRedis } from "../cache/redis.js";
import { prisma } from "../db/prisma.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis | null;
  }
}

export async function registerInfra(server: FastifyInstance) {
  const redis = getRedis();

  server.decorate("prisma", prisma);
  server.decorate("redis", redis);

  prisma.$on("error", (event: { message: string; target: string }) => {
    server.log.error({ event: "db.prisma.error", err: event });
  });

  prisma.$on("warn", (event: { message: string; target: string }) => {
    server.log.warn({ event: "db.prisma.warn", warning: event.message });
  });

  if (redis) {
    redis.on("error", (error: Error) => {
      server.log.error({ event: "cache.redis.error", err: error });
    });
  }

  server.addHook("onClose", async () => {
    await prisma.$disconnect();
    await closeRedis();
  });
}
