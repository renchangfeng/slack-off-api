import { LeaderboardWindow, SocialReactionType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";

const windowValues = [
  LeaderboardWindow.daily,
  LeaderboardWindow.weekly,
  LeaderboardWindow.monthly,
  LeaderboardWindow.all_time
] as const;
const scopeValues = ["global", "friends", "squad", "company"] as const;
type LeaderboardScope = (typeof scopeValues)[number];

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
            scope: { type: "string", enum: scopeValues, default: "global" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
          }
        }
      }
    },
    async (request) => {
      const query = request.query as {
        window: LeaderboardWindow;
        scope?: LeaderboardScope;
        limit?: number;
      };
      const scope = query.scope ?? "global";
      const limit = query.limit ?? 50;
      const windowStart = getWindowStart(query.window, new Date());
      const scopeContext = await resolveScope(server, request.user!.id, scope);

      if (scopeContext.suppressed) {
        return ok({
          window: query.window,
          windowStart: windowStart.toISOString(),
          scope,
          suppressed: true,
          suppressionReason: scopeContext.suppressionReason,
          items: [],
          currentUser: null
        });
      }

      const scores = await server.prisma.leaderboardScore.findMany({
        where: {
          window: query.window,
          windowStart,
          ...(scopeContext.userIds ? { userId: { in: scopeContext.userIds } } : {})
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
      const reactions = await loadReactionCounts(
        server,
        scores.map((score) => score.userId)
      );

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
          (await countAhead(
            server,
            query.window,
            windowStart,
            currentUserScore.score,
            scopeContext.userIds
          )) + 1
        : null;

      return ok({
        window: query.window,
        windowStart: windowStart.toISOString(),
        scope,
        suppressed: false,
        suppressionReason: null,
        items: scores.map((score, index) =>
          serializeScore(
            score,
            index + 1,
            reactions.get(score.userId),
            scopeContext.aliases?.get(score.userId)
          )
        ),
        currentUser:
          currentUserScore && currentUserRank
            ? serializeScore(
                currentUserScore,
                currentUserRank,
                reactions.get(currentUserScore.userId),
                scopeContext.aliases?.get(currentUserScore.userId)
              )
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
  rank: number,
  reactions: { tissue: number; like: number } = { tissue: 0, like: 0 },
  anonymousAlias?: string
) {
  return {
    rank,
    userId: anonymousAlias ? null : score.userId,
    displayName: anonymousAlias ?? score.user.displayName,
    equippedBadge: anonymousAlias ? null : score.user.profile?.equippedBadge?.name ?? null,
    equippedTitle: anonymousAlias ? null : score.user.profile?.equippedTitle?.name ?? null,
    score: score.score,
    reactions
  };
}

async function countAhead(
  server: FastifyInstance,
  window: LeaderboardWindow,
  windowStart: Date,
  score: number,
  userIds?: string[]
): Promise<number> {
  return server.prisma.leaderboardScore.count({
    where: {
      window,
      windowStart,
      ...(userIds ? { userId: { in: userIds } } : {}),
      score: {
        gt: score
      }
    }
  });
}

export async function resolveScope(
  server: FastifyInstance,
  userId: string,
  scope: LeaderboardScope
): Promise<{
  userIds?: string[];
  aliases?: Map<string, string>;
  suppressed: boolean;
  suppressionReason: string | null;
}> {
  if (scope === "global") {
    return { suppressed: false, suppressionReason: null };
  }
  if (scope === "friends") {
    const rows = await server.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] }
    });
    return {
      userIds: [
        userId,
        ...rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId))
      ],
      suppressed: false,
      suppressionReason: null
    };
  }
  if (scope === "squad") {
    const membership = await server.prisma.squadMembership.findUnique({ where: { userId } });
    if (!membership) {
      return { userIds: [], suppressed: true, suppressionReason: "NO_SQUAD" };
    }
    const members = await server.prisma.squadMembership.findMany({
      where: { squadId: membership.squadId },
      select: { userId: true }
    });
    return {
      userIds: members.map((member) => member.userId),
      suppressed: false,
      suppressionReason: null
    };
  }

  const membership = await server.prisma.companyMembership.findUnique({ where: { userId } });
  if (!membership) {
    return { userIds: [], suppressed: true, suppressionReason: "NO_COMPANY" };
  }
  const members = await server.prisma.companyMembership.findMany({
    where: { companyId: membership.companyId },
    select: { userId: true, anonymousAlias: true }
  });
  if (members.length < 3) {
    return { userIds: [], suppressed: true, suppressionReason: "COMPANY_TOO_SMALL" };
  }
  return {
    userIds: members.map((member) => member.userId),
    aliases: new Map(members.map((member) => [member.userId, member.anonymousAlias])),
    suppressed: false,
    suppressionReason: null
  };
}

async function loadReactionCounts(server: FastifyInstance, userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, { tissue: number; like: number }>();
  }
  const rows = await server.prisma.socialReaction.groupBy({
    by: ["recipientId", "reactionType"],
    where: { recipientId: { in: userIds } },
    _count: { _all: true }
  });
  const result = new Map<string, { tissue: number; like: number }>();
  for (const row of rows) {
    const counts = result.get(row.recipientId) ?? { tissue: 0, like: 0 };
    counts[row.reactionType === SocialReactionType.tissue ? "tissue" : "like"] = row._count._all;
    result.set(row.recipientId, counts);
  }
  return result;
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
