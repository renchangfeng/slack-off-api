import type { FastifyInstance } from "fastify";
import type { RuntimeConfig } from "../config/runtime.js";

declare module "fastify" {
  interface FastifyInstance {
    runtimeConfig: RuntimeConfig;
  }
}

export async function registerConfig(server: FastifyInstance, config: RuntimeConfig) {
  server.decorate("runtimeConfig", config);
}
