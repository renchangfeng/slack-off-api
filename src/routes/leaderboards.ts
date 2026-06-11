import { LeaderboardWindow } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";

const windowValues = [
  LeaderboardWindow.daily,
  LeaderboardWindow.weekly,
  LeaderboardWindow.monthly,
  LeaderboardWindow.all_time
] as const;

export async function registerLeaderboardRoutes(server: FastifyInstance) {
  server.get(
    "/v1/leaderboards",
    {
      ...rateLimitFor(server, "leaderboardReads"),
      preHandler: [server.requireAuth],
      schema: {
        querystring: {
          type: "object",
          required: ["window"],
          properties: {
            window: { type: "string", enum: windowValues },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
          }
        }
      }
    },
    async (request) => {
      const query = request.query as {
        window: LeaderboardWindow;
        limit?: number;
      };
      const limit = query.limit ?? 50;
      const windowStart = getWindowStart(query.window, new Date());

      const scores = await server.prisma.leaderboardScore.findMany({
        where: {
          window: query.window,
          windowStart
        },
        orderBy: [{ score: "desc" }, { updatedAt: "asc" }],
        take: limit,
        include: {
          user: {
            include: {
              profile: {
                include: {
                  equippedBadge: true,
                  equippedTitle: true
                }
              }
            }
          }
        }
      });

      const visibleUserIds = new Set(scores.map((score) => score.userId));
      const currentUserScore = visibleUserIds.has(request.user!.id)
        ? scores.find((score) => score.userId === request.user!.id)
        : await server.prisma.leaderboardScore.findUnique({
            where: {
              userId_window_windowStart: {
                userId: request.user!.id,
                window: query.window,
                windowStart
              }
            },
            include: {
              user: {
                include: {
                  profile: {
                    include: {
                      equippedBadge: true,
                      equippedTitle: true
                    }
                  }
                }
              }
            }
          });

      const currentUserRank = currentUserScore
        ? scores.findIndex((score) => score.userId === request.user!.id) + 1 ||
          (await countAhead(server, query.window, windowStart, currentUserScore.score)) + 1
        : null;

      return ok({
        window: query.window,
        windowStart: windowStart.toISOString(),
        items: scores.map((score, index) => serializeScore(score, index + 1)),
        currentUser:
          currentUserScore && currentUserRank
            ? serializeScore(currentUserScore, currentUserRank)
            : null
      });
    }
  );
}

export async function incrementLeaderboardScores(
  prisma: {
    leaderboardScore: {
      upsert: (args: {
        where: {
          userId_window_windowStart: {
            userId: string;
            window: LeaderboardWindow;
            windowStart: Date;
          };
        };
        create: {
          userId: string;
          window: LeaderboardWindow;
          windowStart: Date;
          score: number;
        };
        update: {
          score: { increment: number };
        };
      }) => Promise<unknown>;
    };
  },
  input: {
    userId: string;
    score: number;
    now: Date;
  }
) {
  if (input.score <= 0) {
    return;
  }

  await Promise.all(
    windowValues.map((window) =>
      prisma.leaderboardScore.upsert({
        where: {
          userId_window_windowStart: {
            userId: input.userId,
            window,
            windowStart: getWindowStart(window, input.now)
          }
        },
        create: {
          userId: input.userId,
          window,
          windowStart: getWindowStart(window, input.now),
          score: input.score
        },
        update: {
          score: { increment: input.score }
        }
      })
    )
  );
}

function serializeScore(
  score: {
    userId: string;
    score: number;
    user: {
      displayName: string;
      profile: {
        equippedBadge: { name: string } | null;
        equippedTitle: { name: string } | null;
      } | null;
    };
  },
  rank: number
) {
  return {
    rank,
    userId: score.userId,
    displayName: score.user.displayName,
    equippedBadge: score.user.profile?.equippedBadge?.name ?? null,
    equippedTitle: score.user.profile?.equippedTitle?.name ?? null,
    score: score.score
  };
}

async function countAhead(
  server: FastifyInstance,
  window: LeaderboardWindow,
  windowStart: Date,
  score: number
): Promise<number> {
  return server.prisma.leaderboardScore.count({
    where: {
      window,
      windowStart,
      score: {
        gt: score
      }
    }
  });
}

function getWindowStart(window: LeaderboardWindow, now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (window === LeaderboardWindow.all_time) {
    return new Date(0);
  }

  if (window === LeaderboardWindow.weekly) {
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
  }

  if (window === LeaderboardWindow.monthly) {
    start.setUTCDate(1);
  }

  return start;
}
