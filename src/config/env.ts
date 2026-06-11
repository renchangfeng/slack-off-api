import { z } from "zod";

const schema = z.object({
  CONFIG_SOURCE: z.enum(["env", "nacos"]).default("env"),
  NACOS_SERVER_URL: z.string().url().optional(),
  NACOS_NAMESPACE: z.string().optional(),
  NACOS_GROUP: z.string().default("DEFAULT_GROUP"),
  NACOS_DATA_ID: z.string().default("slack-off-api.json"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional()
});

export const env = schema.parse(process.env);
