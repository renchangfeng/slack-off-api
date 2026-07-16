import {
  ActivityAssignmentStatus,
  ActivityCategory,
  ActivityDifficulty,
  ActivityFeedbackSource,
  ActivityFeedbackType,
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
    profileUpdates: { max: 1000, timeWindow: "1 minute" },
    fishTank: { max: 1000, timeWindow: "1 minute" }
  },
  auth: { requireEmailVerified: false },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 },
  fishTank: {
    starterFishCode: "starter_goldfish",
    feedCooldownSeconds: 4 * 60 * 60,
    bubbleCooldownSeconds: 60 * 60,
    feedCost: 1,
    bubbleCost: 1,
    hatchProgressCost: 3
  }
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
      rewardSummary: { score: 8, drawProgress: 1, rewarded: true }
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
    expect(store.feedbackEvents).toEqual([
      expect.objectContaining({
        assignmentId: assignment.id,
        feedbackType: ActivityFeedbackType.dislike_similar,
        feedbackSource: ActivityFeedbackSource.skip,
        skipReason: "not_interested"
      })
    ]);
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

  it("stores completion feedback for an owned completed activity", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload: { feedbackType: "liked", source: "completion" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      acknowledgement: expect.any(String),
      event: {
        assignmentId: assignment.id,
        templateId,
        category: "game",
        feedbackType: "liked",
        feedbackSource: "completion",
        skipReason: null,
        createdAt: expect.any(String)
      }
    });
    expect(store.feedbackEvents).toHaveLength(1);
    expect(store.feedbackEvents[0]).toMatchObject({
      userId,
      assignmentId: assignment.id,
      feedbackType: ActivityFeedbackType.liked,
      feedbackSource: ActivityFeedbackSource.completion,
      skipReason: null
    });

    await server.close();
  });

  it("rejects invalid feedback type without storing an event", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload: { feedbackType: "unknown", source: "completion" }
    });

    expect(response.statusCode).toBe(400);
    expect(store.feedbackEvents).toHaveLength(0);

    await server.close();
  });

  it("does not let a user submit feedback for another user's activity", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId: otherUserId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload: { feedbackType: "liked", source: "completion" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ACTIVITY_NOT_FOUND");
    expect(store.feedbackEvents).toHaveLength(0);

    await server.close();
  });

  it("rejects feedback for an active assignment", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({ userId });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload: { feedbackType: "liked", source: "completion" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACTIVITY_FEEDBACK_NOT_READY");
    expect(store.feedbackEvents).toHaveLength(0);

    await server.close();
  });

  it("keeps repeated identical feedback idempotent", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const payload = { feedbackType: "liked", source: "completion" };
    const first = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload
    });
    const second = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.event.id).toBe(first.json().data.event.id);
    expect(store.feedbackEvents).toHaveLength(1);

    await server.close();
  });
  it("returns feedback-aware recommendation explanations when feedback is relevant", async () => {
    const server = await buildTestServer(store);
    store.addTemplate(imaginationTemplate());
    store.feedbackEvents.push({
      id: "66666666-6666-4666-8666-000000000001",
      userId,
      assignmentId: null,
      templateId,
      category: ActivityCategory.game,
      feedbackType: ActivityFeedbackType.want_weirder,
      feedbackSource: ActivityFeedbackSource.completion,
      skipReason: null,
      interactionTypes: [],
      metadata: {},
      createdAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/activities/random",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      recommendationReason: "WEIRDER_AFTER_FEEDBACK",
      recommendationExplanation: "你最近想来点更怪的，所以这次偏脑洞和表演一点。"
    });

    await server.close();
  });

  it("completes a mini-interaction activity and returns step summaries", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      template: miniInteractionTemplate()
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: {
        interaction: {
          completedStepIds: ["ack_ready"],
          tapCounts: { pop_bubbles: 5 }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      resultTitle: expect.any(String),
      resultCopy: expect.any(String),
      stepSummaries: expect.arrayContaining(["完成", "点击 5 次"])
    });
    expect(store.assignments[0]).toMatchObject({
      status: ActivityAssignmentStatus.completed,
      rewarded: true
    });

    await server.close();
  });

  it("rejects a mini-interaction activity until all required steps are complete", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      template: miniInteractionTemplate()
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/complete`,
      headers: { authorization: "Bearer test" },
      payload: {
        interaction: {
          completedStepIds: ["ack_ready"],
          tapCounts: { pop_bubbles: 2 }
        }
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INTERACTION_INCOMPLETE");
    expect(store.rewardLedger).toHaveLength(0);

    await server.close();
  });

  it("returns private activity history ordered newest first", async () => {
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
      url: "/v1/activities/history",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assignmentId: expect.any(String),
      status: ActivityAssignmentStatus.completed,
      rewardSummary: { score: 8, drawProgress: 1, rewarded: true }
    });

    await server.close();
  });

  it("filters history by today window", async () => {
    const server = await buildTestServer(store);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      assignedAt: today,
      completedAt: today,
      rewarded: true
    });
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.skipped,
      assignedAt: yesterday,
      rewarded: false
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history?window=today",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.json().data.items[0].status).toBe(ActivityAssignmentStatus.completed);

    await server.close();
  });

  it("includes an activity assigned yesterday but completed today in today's history", async () => {
    const server = await buildTestServer(store);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      assignedAt: yesterday,
      completedAt: today,
      rewarded: true
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history?window=today",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.json().data.items[0].assignmentId).toBe(assignment.id);

    await server.close();
  });

  it("returns presentation data that matches the public contract", async () => {
    const server = await buildTestServer(store);
    store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0].presentation.prompt).toEqual(expect.any(String));

    await server.close();
  });

  it("includes skip reason and no-reward state for skipped sessions", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.active,
      rewarded: false
    });
    await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/skip`,
      headers: { authorization: "Bearer test" },
      payload: { reason: "want_weirder" }
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().data.items[0];
    expect(item.status).toBe(ActivityAssignmentStatus.skipped);
    expect(item.skipReason).toBe("want_weirder");
    expect(item.rewardSummary.rewarded).toBe(false);
    expect(item.replayHint.excludeTemplateId).toBe(assignment.templateId);

    await server.close();
  });

  it("includes completion feedback acknowledgement in history", async () => {
    const server = await buildTestServer(store);
    const assignment = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });
    await server.inject({
      method: "POST",
      url: `/v1/activities/${assignment.id}/feedback`,
      headers: { authorization: "Bearer test" },
      payload: { feedbackType: "liked", source: "completion" }
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/activities/history",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().data.items[0];
    expect(item.feedback).toMatchObject({
      type: "liked",
      acknowledgement: expect.any(String)
    });

    await server.close();
  });

  it("paginates history with cursor", async () => {
    const server = await buildTestServer(store);
    const now = new Date();
    const first = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      assignedAt: now,
      completedAt: now,
      rewarded: true
    });
    const second = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      assignedAt: new Date(now.getTime() - 1000),
      completedAt: new Date(now.getTime() - 1000),
      rewarded: true
    });

    const firstPage = await server.inject({
      method: "GET",
      url: "/v1/activities/history?limit=1",
      headers: { authorization: "Bearer test" }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().data.items).toHaveLength(1);
    expect(firstPage.json().data.items[0].assignmentId).toBe(first.id);
    expect(firstPage.json().data.nextCursor).toBeTruthy();

    const secondPage = await server.inject({
      method: "GET",
      url: `/v1/activities/history?limit=1&cursor=${encodeURIComponent(firstPage.json().data.nextCursor)}`,
      headers: { authorization: "Bearer test" }
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().data.items).toHaveLength(1);
    expect(secondPage.json().data.items[0].assignmentId).toBe(second.id);

    await server.close();
  });

  it("replays similar activity without reactivating old assignment or duplicating rewards", async () => {
    const server = await buildTestServer(store);
    store.addTemplate(imaginationTemplate());
    const original = store.addAssignment({
      userId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/activities/random",
      headers: { authorization: "Bearer test" },
      payload: {
        replayHint: { sourceAssignmentId: original.id }
      }
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.assignmentId).not.toBe(original.id);
    expect(data.status).toBe(ActivityAssignmentStatus.active);
    expect(data.templateId).not.toBe(original.templateId);
    expect(store.assignments).toHaveLength(2);
    expect(store.rewardLedger).toHaveLength(0);

    await server.close();
  });

  it("ignores replay hint for non-owned assignment", async () => {
    const server = await buildTestServer(store);
    const original = store.addAssignment({
      userId: otherUserId,
      status: ActivityAssignmentStatus.completed,
      completedAt: new Date(),
      rewarded: true
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/activities/random",
      headers: { authorization: "Bearer test" },
      payload: {
        replayHint: { sourceAssignmentId: original.id }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe(ActivityAssignmentStatus.active);

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

function imaginationTemplate() {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    code: "daydream_cloud",
    title: "给云取一个工位名",
    description: "给不存在的云同事起一个合理名字。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4, drawProgress: 1 },
    cooldownSeconds: 0,
    dailyRewardLimit: 3,
    active: true
  };
}

function miniInteractionTemplate() {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    code: "close_eyes",
    title: "闭眼点掉 5 个焦虑泡泡",
    description: "不是睡着，只是暂时拒绝接收视觉需求。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: {
      score: 3,
      interaction: {
        mode: "guided",
        estimatedSeconds: 35,
        proofPolicy: "none",
        flavorLabel: "闭眼点击",
        steps: [
          {
            id: "ack_ready",
            type: "ack",
            title: "准备好闭眼",
            description: "轻轻闭上眼睛，不舒服就随时睁开。",
            required: true
          },
          {
            id: "pop_bubbles",
            type: "tap-pattern",
            title: "点掉 5 个焦虑泡泡",
            description: "每点一下，想象一个念头暂时浮走。",
            required: true,
            requiredTaps: 5,
            tapLabel: "泡泡"
          }
        ],
        completionFeedback: ["泡泡点完，视觉需求暂时被拒收。"],
        resultSummary: {
          title: "视觉下线成功",
          copy: "你短暂地拒绝了所有像素，焦虑泡泡也暂时离开了。"
        }
      }
    },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3,
    active: true
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

type TestTemplate = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: ActivityCategory;
  difficulty: ActivityDifficulty;
  rewardConfig: Record<string, unknown>;
  cooldownSeconds: number;
  dailyRewardLimit: number;
  active: boolean;
};

type TestStore = ReturnType<typeof createStore>;

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
  template: TestTemplate;
};

type TestFeedbackEvent = {
  id: string;
  userId: string;
  assignmentId: string | null;
  templateId: string;
  category: ActivityCategory;
  feedbackType: ActivityFeedbackType;
  feedbackSource: ActivityFeedbackSource;
  skipReason: string | null;
  interactionTypes: unknown;
  metadata: unknown;
  createdAt: Date;
};

function createStore() {
  let nextAssignmentId = 1;
  const template: TestTemplate = {
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
  const templates: TestTemplate[] = [template];
  const assignments: TestAssignment[] = [];
  const stats = new Map<string, { userId: string; drawProgress: number; drawChances: number }>();
  const rewardLedger: Array<Record<string, unknown>> = [];
  const leaderboardScores: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const feedbackEvents: TestFeedbackEvent[] = [];

  return {
    template,
    templates,
    assignments,
    addTemplate(input: TestTemplate) {
      templates.push(input);
      return input;
    },
    stats,
    rewardLedger,
    leaderboardScores,
    auditEvents,
    feedbackEvents,
    addAssignment(input: {
      userId: string;
      status?: ActivityAssignmentStatus;
      rewarded?: boolean;
      assignedAt?: Date;
      completedAt?: Date | null;
      expiresAt?: Date | null;
      template?: TestTemplate;
    }) {
      const assignmentTemplate = input.template ?? template;
      const assignment: TestAssignment = {
        id: `55555555-5555-4555-8555-${String(nextAssignmentId++).padStart(12, "0")}`,
        userId: input.userId,
        templateId: assignmentTemplate.id,
        status: input.status ?? ActivityAssignmentStatus.active,
        assignedAt: input.assignedAt ?? new Date(),
        completedAt: input.completedAt ?? null,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 1000 * 60 * 30),
        rewarded: input.rewarded ?? false,
        idempotencyKey: null,
        template: assignmentTemplate
      };
      assignments.push(assignment);
      return assignment;
    }
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    activityTemplate: {
      findMany: async () => store.templates
    },
    activityAssignment: {
      findFirst: async ({ where }: { where: { userId: string; status: ActivityAssignmentStatus } }) =>
        store.assignments.find(
          (assignment) => assignment.userId === where.userId && assignment.status === where.status
        ) ?? null,
      findMany: async ({
        where,
        orderBy,
        take
      }: {
        where: {
          userId: string;
          templateId?: { in: string[] };
          status?: { in: ActivityAssignmentStatus[] };
          assignedAt?: { gte?: Date; lt?: Date };
          completedAt?: { gte?: Date; lt?: Date } | null;
          OR?: Array<
            | { completedAt: { gte?: Date; lt?: Date } }
            | { completedAt: null; assignedAt: { gte?: Date; lt?: Date } }
            | { assignedAt: { lt: Date } }
            | { assignedAt: Date; id: { lt: string } }
          >;
          AND?: Array<{
            OR?: Array<
              | { assignedAt: { lt: Date } }
              | { assignedAt: Date; id: { lt: string } }
            >;
          }>;
        };
        orderBy?: Array<{ assignedAt: "desc" } | { id: "desc" }> | { assignedAt: "desc" };
        take?: number;
      }) => {
        const matchesWhere = (
          assignment: TestAssignment,
          condition: typeof where | NonNullable<typeof where.OR>[number] | NonNullable<typeof where.AND>[number]
        ): boolean => {
          if ("userId" in condition && assignment.userId !== condition.userId) return false;
          if ("templateId" in condition && condition.templateId && !condition.templateId.in.includes(assignment.templateId)) return false;
          if ("status" in condition && condition.status && !condition.status.in.includes(assignment.status)) return false;
          if ("completedAt" in condition) {
            if (condition.completedAt === null && assignment.completedAt !== null) return false;
            if (condition.completedAt && assignment.completedAt === null) return false;
            if (condition.completedAt?.gte && assignment.completedAt! < condition.completedAt.gte) return false;
            if (condition.completedAt?.lt && assignment.completedAt! >= condition.completedAt.lt) return false;
          }
          if ("assignedAt" in condition) {
            if (condition.assignedAt instanceof Date) {
              if (assignment.assignedAt.getTime() !== condition.assignedAt.getTime()) return false;
            } else {
              const assignedAtRange = condition.assignedAt as { gte?: Date; lt?: Date };
              if (assignedAtRange.gte && assignment.assignedAt < assignedAtRange.gte) return false;
              if (assignedAtRange.lt && assignment.assignedAt >= assignedAtRange.lt) return false;
            }
          }
          if ("id" in condition && condition.id && "lt" in condition.id && !(assignment.id < condition.id.lt)) return false;
          if ("OR" in condition && condition.OR) {
            if (!condition.OR.some((nested) => matchesWhere(assignment, nested))) return false;
          }
          if ("AND" in condition && condition.AND) {
            if (!condition.AND.every((nested) => matchesWhere(assignment, nested))) return false;
          }
          return true;
        };
        let filtered = store.assignments.filter((assignment) => {
          if (assignment.userId !== where.userId) return false;
          if (where.templateId && !where.templateId.in.includes(assignment.templateId)) return false;
          if (where.status && !where.status.in.includes(assignment.status)) return false;
          if (where.assignedAt?.gte && assignment.assignedAt < where.assignedAt.gte) return false;
          if (where.assignedAt?.lt && assignment.assignedAt >= where.assignedAt.lt) return false;
          return matchesWhere(assignment, where);
        });
        const sortByAssignedAt = orderBy
          ? Array.isArray(orderBy)
            ? orderBy.find((item) => "assignedAt" in item)
            : "assignedAt" in orderBy
              ? orderBy
              : undefined
          : undefined;
        if (sortByAssignedAt) {
          const direction = (sortByAssignedAt.assignedAt as string) === "asc" ? 1 : -1;
          filtered = filtered.slice().sort((left, right) => {
            const timeDiff =
              direction * (left.assignedAt.getTime() - right.assignedAt.getTime());
            if (timeDiff !== 0) return timeDiff;
            return direction * (left.id < right.id ? -1 : 1);
          });
        }
        return take ? filtered.slice(0, take) : filtered;
      },
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
    activityFeedbackEvent: {
      upsert: async ({
        where,
        create
      }: {
        where: {
          userId_assignmentId_feedbackType_feedbackSource: {
            userId: string;
            assignmentId: string;
            feedbackType: ActivityFeedbackType;
            feedbackSource: ActivityFeedbackSource;
          };
        };
        create: Omit<TestFeedbackEvent, "id" | "createdAt">;
        update: Record<string, never>;
      }) => {
        const key = where.userId_assignmentId_feedbackType_feedbackSource;
        const existing = store.feedbackEvents.find(
          (event) =>
            event.userId === key.userId &&
            event.assignmentId === key.assignmentId &&
            event.feedbackType === key.feedbackType &&
            event.feedbackSource === key.feedbackSource
        );
        if (existing) {
          return existing;
        }
        const event: TestFeedbackEvent = {
          ...create,
          id: `66666666-6666-4666-8666-${String(store.feedbackEvents.length + 1).padStart(12, "0")}`,
          createdAt: new Date()
        };
        store.feedbackEvents.push(event);
        return event;
      },
      findMany: async ({
        where,
        orderBy,
        take
      }: {
        where: {
          userId: string;
          createdAt?: { gte: Date };
          assignmentId?: { in: string[] };
        };
        orderBy?: { createdAt: "desc" };
        take?: number;
      }) => {
        const events = store.feedbackEvents.filter(
          (event) =>
            event.userId === where.userId &&
            (!where.createdAt || event.createdAt >= where.createdAt.gte) &&
            (!where.assignmentId || (event.assignmentId && where.assignmentId.in.includes(event.assignmentId)))
        );
        if (orderBy?.createdAt === "desc") {
          events.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return events.slice(0, take);
      }
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
