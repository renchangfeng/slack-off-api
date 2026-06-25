import {
  ActivityAssignmentStatus,
  ActivityCategory,
  ActivityDifficulty,
  RewardSourceType,
  RewardType
} from "@prisma/client";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerActivityRoutes } from "./activities.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";

const runtimeConfig: RuntimeConfig = {
  rateLimits: {
    global: { max: 1000, timeWindow: "1 minute" },
    otp: { max: 1000, timeWindow: "1 minute" },
    checkIns: { max: 1000, timeWindow: "1 minute" },
    activities: { max: 1000, timeWindow: "1 minute" },
    beanDraws: { max: 1000, timeWindow: "1 minute" },
    leaderboardReads: { max: 1000, timeWindow: "1 minute" },
    profileUpdates: { max: 1000, timeWindow: "1 minute" }
  },
  auth: { requireEmailVerified: false },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 }
};

describe("activity routes", () => {
  let store: TestStore;

  beforeEach(() => {
    store = createStore();
  });

  it("assigns a random eligible activity", async () => {
    const server = await buildTestServer(store);

    const response = await server.inject({
      method: "POST",
      url: "/v1/activities/random",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      code: "match_three_rounds",
      title: "完成消消乐 3 关",
      category: ActivityCategory.game,
      difficulty: ActivityDifficulty.normal,
      status: ActivityAssignmentStatus.active,
      recommendationReason: "TRY_SOMETHING_NEW",
      recommendationExplanation: expect.any(String),
      rewardPreview: {
        score: 8,
        drawProgress: 1
      },
      presentation: expect.objectContaining({
        badge: expect.any(String),
        tone: "game",
        accentColor: expect.any(String),
        headline: "完成消消乐 3 关",
        scene: expect.any(String),
        prompt: expect.any(String),
        statLabel: expect.any(String),
        statValue: expect.stringMatching(/%$/)
      }),
      interaction: expect.objectContaining({
        mode: "guided",
        flavorLabel: expect.any(String),
        resultSummary: expect.objectContaining({
          title: expect.any(String),
          copy: expect.any(String)
        }),
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "notice", type: "ack" }),
          expect.objectContaining({ id: "mini_game", type: "mini_game" })
        ])
      }),
      interactionSummary: expect.objectContaining({
        stepCount: 2,
        hasMiniGame: true,
        flavorLabel: expect.any(String)
      })
    });
    expect(store.assignments).toHaveLength(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.random.assigned",
          traceId: expect.stringMatching(/^trc_/)
        })
      ])
    );

    await server.close();
  });

  it("returns a category-filtered catalog with cooldown state", async () => {
    const server = await buildTestServer(store);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/catalog?category=game",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      selectedCategory: "game",
      categories: ["rest", "game", "office_theater", "physical", "imagination"],
      items: [
        {
          code: "match_three_rounds",
          category: "game",
          eligible: false,
          completedCount: 1,
          presentation: expect.objectContaining({
            badge: expect.any(String),
            tone: "game",
            headline: "完成消消乐 3 关"
          }),
          interactionSummary: expect.objectContaining({
            hasMiniGame: true,
            flavorLabel: expect.any(String)
          })
        }
      ]
    });

    await server.close();
  });

  it("returns recent activity history for the authenticated user", async () => {
    const server = await buildTestServer(store);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });
    store.addAssignment({
      userId: otherUserId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history?limit=5",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.json().data.items[0]).toMatchObject({
      code: "match_three_rounds",
      category: "game",
      status: "completed",
      rewarded: true
    });

    await server.close();
  });

  it("rejects random assignment while all activities are cooling down", async () => {
    const server = await buildTestServer(store);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      rewarded: true,
      completedAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/activities/random",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NO_ELIGIBLE_ACTIVITY");
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.random.rejected",
          metadata: { reason: "NO_ELIGIBLE_ACTIVITY" }
        })
      ])
    );

    await server.close();
  });

  it("completes an activity with rewards and audit event", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({ userId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: gameInteractionProgress()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.reward).toMatchObject({
      score: 8,
      drawProgress: 1,
      drawChancesGranted: 0,
      rewarded: true,
      reason: null
    });
    expect(response.json().data.feedback).toEqual(expect.any(String));
    expect(response.json().data.resultTitle).toEqual(expect.any(String));
    expect(response.json().data.resultCopy).toEqual(expect.any(String));
    expect(response.json().data.assignment.presentation).toMatchObject({
      tone: "game",
      headline: "完成消消乐 3 关"
    });
    expect(store.assignments[0]).toMatchObject({
      status: ActivityAssignmentStatus.completed,
      rewarded: true
    });
    expect(store.rewardLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: RewardSourceType.activity,
          rewardType: RewardType.score,
          amount: 8
        }),
        expect.objectContaining({
          sourceType: RewardSourceType.activity,
          rewardType: RewardType.draw_progress,
          amount: 1
        })
      ])
    );
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.complete.rewarded"
        })
      ])
    );

    await server.close();
  });

  it("rejects completion until the interaction flow is satisfied", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({ userId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: { interaction: { completedStepIds: ["notice"] } }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INTERACTION_INCOMPLETE");
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.assignments[0]).toMatchObject({
      status: ActivityAssignmentStatus.active,
      rewarded: false
    });

    await server.close();
  });

  it("completes without rewards after the daily template limit", async () => {
    const server = await buildTestServer(store);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      rewarded: true,
      completedAt: new Date()
    });
    const assignment = store.addAssignment({ userId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: gameInteractionProgress()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.reward).toMatchObject({
      score: 0,
      drawProgress: 0,
      rewarded: false,
      reason: "DAILY_LIMIT_REACHED"
    });
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.complete.no_reward",
          metadata: expect.objectContaining({ dailyLimitReached: true })
        })
      ])
    );

    await server.close();
  });

  it("rejects expired activity completion with an audit reason", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      expiresAt: new Date(Date.now() - 1000)
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: gameInteractionProgress()
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACTIVITY_EXPIRED");
    expect(store.assignments[0]).toMatchObject({
      status: ActivityAssignmentStatus.expired,
      rewarded: false
    });
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.complete.rejected",
          metadata: { reason: "ACTIVITY_EXPIRED" }
        })
      ])
    );

    await server.close();
  });

  it("does not let a user complete another user's activity", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({ userId: otherUserId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: gameInteractionProgress()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ACTIVITY_NOT_FOUND");
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.assignments[0]).toMatchObject({
      status: ActivityAssignmentStatus.active
    });

    await server.close();
  });

  it("skips an active activity without rewards", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({ userId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/skip`,
      headers: { authorization: "Bearer test" },
      payload: { reason: "not_interested" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      assignmentId: assignment.id,
      status: ActivityAssignmentStatus.skipped,
      rewarded: false
    });
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "activity.skipped",
          metadata: expect.objectContaining({ reason: "not_interested" })
        })
      ])
    );

    await server.close();
  });
});

function gameInteractionProgress() {
  return {
    interaction: {
      completedStepIds: ["notice"],
      miniGameResults: {
        mini_game: { passed: true, score: 3 }
      }
    }
  };
}

async function buildTestServer(store: TestStore) {
  const server = Fastify({ logger: false });
  server.decorate("prisma", createPrismaMock(store) as never);
  server.decorate("redis", null);
  await registerConfig(server, runtimeConfig);
  await registerObservability(server);
  server.decorateRequest("user");
  server.decorate("requireAuth", async (request) => {
    request.user = {
      id: userId,
      authSubject: userId,
      email: "tester@example.com",
      displayName: "tester"
    };
  });
  await server.register(registerActivityRoutes);
  await server.ready();
  return server;
}

type TestAssignment = {
  id: string;
  userId: string;
  templateId: string;
  status: ActivityAssignmentStatus;
  assignedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  rewarded: boolean;
  idempotencyKey: string | null;
  template: TestStore["template"];
};

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  let nextAssignmentId = 1;
  const template = {
    id: templateId,
    code: "match_three_rounds",
    title: "完成消消乐 3 关",
    description: "不要解释，这是手眼协调训练。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 8, drawProgress: 1 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 1,
    active: true
  };
  const assignments: TestAssignment[] = [];
  const stats = new Map<string, { userId: string; drawProgress: number; drawChances: number }>();
  const rewardLedger: Array<Record<string, unknown>> = [];
  const leaderboardScores: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  return {
    template,
    assignments,
    stats,
    rewardLedger,
    leaderboardScores,
    auditEvents,
    addAssignment(input: {
      userId: string;
      status?: ActivityAssignmentStatus;
      rewarded?: boolean;
      assignedAt?: Date;
      completedAt?: Date | null;
      expiresAt?: Date | null;
    }) {
      const assignment: TestAssignment = {
        id: `55555555-5555-4555-8555-${String(nextAssignmentId++).padStart(12, "0")}`,
        userId: input.userId,
        templateId,
        status: input.status ?? ActivityAssignmentStatus.active,
        assignedAt: input.assignedAt ?? new Date(),
        completedAt: input.completedAt ?? null,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 1000 * 60 * 30),
        rewarded: input.rewarded ?? false,
        idempotencyKey: null,
        template
      };
      assignments.push(assignment);
      return assignment;
    }
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    activityTemplate: {
      findMany: async () => [store.template]
    },
    activityAssignment: {
      findFirst: async ({ where }: { where: { userId: string; status: ActivityAssignmentStatus } }) =>
        store.assignments.find(
          (assignment) => assignment.userId === where.userId && assignment.status === where.status
        ) ?? null,
      findMany: async ({
        where,
        take
      }: {
        where: {
          userId: string;
          templateId?: { in: string[] };
          status?: { in: ActivityAssignmentStatus[] };
        };
        take?: number;
      }) =>
        store.assignments
          .filter(
            (assignment) =>
              assignment.userId === where.userId &&
              (!where.templateId || where.templateId.in.includes(assignment.templateId)) &&
              (!where.status || where.status.in.includes(assignment.status))
          )
          .slice(0, take),
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.assignments.find((assignment) => assignment.id === where.id) ?? null,
      count: async ({
        where
      }: {
        where: {
          userId: string;
          templateId: string;
          status: ActivityAssignmentStatus;
          rewarded: boolean;
          completedAt: { gte: Date; lt: Date };
        };
      }) =>
        store.assignments.filter(
          (assignment) =>
            assignment.userId === where.userId &&
            assignment.templateId === where.templateId &&
            assignment.status === where.status &&
            assignment.rewarded === where.rewarded &&
            assignment.completedAt !== null &&
            assignment.completedAt >= where.completedAt.gte &&
            assignment.completedAt < where.completedAt.lt
        ).length,
      create: async ({ data }: { data: Omit<TestAssignment, "id" | "template" | "completedAt" | "rewarded" | "idempotencyKey"> }) =>
        store.addAssignment({
          userId: data.userId,
          assignedAt: data.assignedAt,
          expiresAt: data.expiresAt
        }),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<TestAssignment>;
      }) => {
        const assignment = store.assignments.find((item) => item.id === where.id);
        if (!assignment) {
          throw new Error("Assignment not found");
        }
        Object.assign(assignment, data);
        return assignment;
      }
    },
    userStats: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        store.stats.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId: string };
        create: { userId: string; drawProgress: number; drawChances: number };
        update: { drawProgress: number; drawChances: { increment: number } };
      }) => {
        const current = store.stats.get(where.userId);
        if (!current) {
          store.stats.set(where.userId, create);
          return create;
        }
        current.drawProgress = update.drawProgress;
        current.drawChances += update.drawChances.increment;
        return current;
      }
    },
    rewardLedger: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        store.rewardLedger.push(...data);
        return { count: data.length };
      }
    },
    leaderboardScore: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        store.leaderboardScores.push(create);
        return create;
      },
      findUnique: async () => null,
      count: async () => 0
    },
    achievement: {
      findMany: async () => []
    },
    userAchievement: {
      findMany: async () => []
    },
    beanInventory: {
      count: async () => 0
    },
    auditEvent: {
      findMany: async ({
        where,
        take
      }: {
        where: { actorUserId: string; eventType: string };
        take?: number;
      }) =>
        store.auditEvents
          .filter(
            (event) =>
              event.actorUserId === where.actorUserId && event.eventType === where.eventType
          )
          .slice(0, take),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.auditEvents.push(data);
        return data;
      }
    },
    $transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => fn(prisma)
  };

  return prisma;
}
