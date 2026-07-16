import { z } from "zod";
import { env } from "./env.js";

const rateLimitPolicySchema = z.object({
  max: z.number().int().positive(),
  timeWindow: z.string()
});

const runtimeConfigSchema = z.object({
  rateLimits: z.object({
    global: rateLimitPolicySchema,
    otp: rateLimitPolicySchema,
    checkIns: rateLimitPolicySchema,
    activities: rateLimitPolicySchema,
    beanDraws: rateLimitPolicySchema,
    leaderboardReads: rateLimitPolicySchema,
    profileUpdates: rateLimitPolicySchema,
    fishTank: rateLimitPolicySchema
  }),
  auth: z.object({
    requireEmailVerified: z.boolean()
  }),
  checkIns: z.object({
    minRewardDurationSeconds: z.number().int().positive(),
    maxSessionSeconds: z.number().int().positive(),
    dailyRewardedSessionCap: z.number().int().positive(),
    scorePerEligibleMinute: z.number().int().positive(),
    drawProgressPerSession: z.number().int().nonnegative()
  }),
  beans: z.object({
    drawProgressPerChance: z.number().int().positive()
  }),
  fishTank: z.object({
    starterFishCode: z.string(),
    feedCooldownSeconds: z.number().int().positive(),
    bubbleCooldownSeconds: z.number().int().positive(),
    feedCost: z.number().int().positive(),
    bubbleCost: z.number().int().positive(),
    hatchProgressCost: z.number().int().positive()
  })
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type RateLimitPolicy = z.infer<typeof rateLimitPolicySchema>;

const defaults: RuntimeConfig = {
  rateLimits: {
    global: { max: 120, timeWindow: "1 minute" },
    otp: { max: 5, timeWindow: "15 minutes" },
    checkIns: { max: 30, timeWindow: "1 minute" },
    activities: { max: 30, timeWindow: "1 minute" },
    beanDraws: { max: 10, timeWindow: "1 minute" },
    leaderboardReads: { max: 120, timeWindow: "1 minute" },
    profileUpdates: { max: 10, timeWindow: "1 minute" },
    fishTank: { max: 30, timeWindow: "1 minute" }
  },
  auth: {
    requireEmailVerified: false
  },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: {
    drawProgressPerChance: 3
  },
  fishTank: {
    starterFishCode: "starter_goldfish",
    feedCooldownSeconds: 4 * 60 * 60,
    bubbleCooldownSeconds: 60 * 60,
    feedCost: 1,
    bubbleCost: 1,
    hatchProgressCost: 3
  }
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (env.CONFIG_SOURCE === "nacos") {
    const nacosConfig = await loadNacosConfig();
    return runtimeConfigSchema.parse(deepMerge(defaults, nacosConfig));
  }

  return runtimeConfigSchema.parse(defaults);
}

async function loadNacosConfig(): Promise<unknown> {
  if (!env.NACOS_SERVER_URL) {
    throw new Error("NACOS_SERVER_URL is required when CONFIG_SOURCE=nacos");
  }

  const url = new URL("/nacos/v1/cs/configs", env.NACOS_SERVER_URL);
  url.searchParams.set("dataId", env.NACOS_DATA_ID);
  url.searchParams.set("group", env.NACOS_GROUP);
  if (env.NACOS_NAMESPACE) {
    url.searchParams.set("tenant", env.NACOS_NAMESPACE);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Nacos config: ${response.status}`);
  }

  return JSON.parse(await response.text()) as unknown;
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isRecord(override)) {
    return base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }

  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
