import { Prisma, SocialReactionType } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { customAlphabet } from "nanoid";
import { recordAuditEventWithClient } from "../audit/events.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";

const makeCode = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);
const reactionValues = [SocialReactionType.tissue, SocialReactionType.like] as const;
const dailyReactionLimit = 10;

export async function registerSocialRoutes(server: FastifyInstance) {
  server.get(
    "/v1/social/summary",
    {
      ...rateLimitFor(server, "leaderboardReads"),
      preHandler: [server.requireAuth]
    },
    async (request) => ok(await socialSummary(server, request.user!.id))
  );

  server.post(
    "/v1/social/friends",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["friendCode"],
          properties: { friendCode: { type: "string", minLength: 6, maxLength: 16 } }
        }
      }
    },
    async (request, reply) => {
      const actorId = request.user!.id;
      const friendCode = (request.body as { friendCode: string }).friendCode.trim().toUpperCase();
      const target = await server.prisma.user.findUnique({ where: { friendCode } });
      if (!target) {
        return sendError(reply, request, 404, "FRIEND_CODE_NOT_FOUND", "Friend code not found");
      }
      if (target.id === actorId) {
        return sendError(reply, request, 409, "SELF_FRIENDSHIP", "You cannot add yourself");
      }

      const [userAId, userBId] = canonicalPair(actorId, target.id);
      const friendship = await server.prisma.friendship.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: { userAId, userBId },
        update: {}
      });
      await auditSocial(server, request, "social.friend.added", target.id, "friendship", friendship.id);
      return ok(await socialSummary(server, actorId));
    }
  );

  server.delete(
    "/v1/social/friends/:userId",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request) => {
      const actorId = request.user!.id;
      const targetId = (request.params as { userId: string }).userId;
      const [userAId, userBId] = canonicalPair(actorId, targetId);
      await server.prisma.friendship.deleteMany({ where: { userAId, userBId } });
      await auditSocial(server, request, "social.friend.removed", targetId, "friendship");
      return ok(await socialSummary(server, actorId));
    }
  );

  registerGroupRoutes(server, "squad");
  registerGroupRoutes(server, "company");

  server.post(
    "/v1/social/reactions",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["recipientUserId", "reactionType"],
          properties: {
            recipientUserId: { type: "string", format: "uuid" },
            reactionType: { type: "string", enum: reactionValues }
          }
        }
      }
    },
    async (request, reply) => {
      const actorId = request.user!.id;
      const body = request.body as {
        recipientUserId: string;
        reactionType: SocialReactionType;
      };
      if (body.recipientUserId === actorId) {
        return sendError(reply, request, 409, "SELF_REACTION", "You cannot react to yourself");
      }
      const recipient = await server.prisma.user.findUnique({
        where: { id: body.recipientUserId },
        select: { id: true }
      });
      if (!recipient) {
        return sendError(reply, request, 404, "REACTION_TARGET_NOT_FOUND", "User not found");
      }

      const reactionDate = utcDate(new Date());
      const sentToday = await server.prisma.socialReaction.count({
        where: { senderId: actorId, reactionDate }
      });
      if (sentToday >= dailyReactionLimit) {
        return sendError(reply, request, 429, "REACTION_DAILY_LIMIT", "Daily reaction limit reached");
      }

      let created = true;
      let reaction;
      try {
        reaction = await server.prisma.socialReaction.create({
          data: {
            senderId: actorId,
            recipientId: body.recipientUserId,
            reactionType: body.reactionType,
            reactionDate
          }
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) {
          throw error;
        }
        created = false;
        reaction = await server.prisma.socialReaction.findUniqueOrThrow({
          where: {
            senderId_recipientId_reactionType_reactionDate: {
              senderId: actorId,
              recipientId: body.recipientUserId,
              reactionType: body.reactionType,
              reactionDate
            }
          }
        });
      }

      if (created) {
        await auditSocial(
          server,
          request,
          "social.reaction.sent",
          body.recipientUserId,
          "social_reaction",
          reaction.id,
          { reactionType: body.reactionType }
        );
      }
      const counts = await reactionCounts(server, body.recipientUserId);
      return ok({ created, reactionType: body.reactionType, counts, remainingToday: Math.max(0, dailyReactionLimit - sentToday - (created ? 1 : 0)) });
    }
  );
}

function registerGroupRoutes(server: FastifyInstance, kind: "squad" | "company") {
  const path = `/v1/social/${kind}`;

  server.post(
    path,
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 2, maxLength: 40 } }
        }
      }
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const name = (request.body as { name: string }).name.trim();
      if (await currentMembership(server, kind, userId)) {
        return sendError(reply, request, 409, "GROUP_MEMBERSHIP_EXISTS", `Already in a ${kind}`);
      }
      const inviteCode = makeCode();
      const group =
        kind === "squad"
          ? await server.prisma.squad.create({
              data: {
                name,
                inviteCode,
                ownerId: userId,
                memberships: { create: { userId } }
              }
            })
          : await server.prisma.company.create({
              data: {
                name,
                inviteCode,
                ownerId: userId,
                memberships: { create: { userId, anonymousAlias: anonymousAlias(1) } }
              }
            });
      await auditSocial(server, request, `social.${kind}.created`, userId, kind, group.id);
      return ok(await socialSummary(server, userId));
    }
  );

  server.post(
    `${path}/join`,
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["inviteCode"],
          properties: { inviteCode: { type: "string", minLength: 6, maxLength: 16 } }
        }
      }
    },
    async (request, reply) => {
      const userId = request.user!.id;
      if (await currentMembership(server, kind, userId)) {
        return sendError(reply, request, 409, "GROUP_MEMBERSHIP_EXISTS", `Already in a ${kind}`);
      }
      const inviteCode = (request.body as { inviteCode: string }).inviteCode.trim().toUpperCase();
      const group =
        kind === "squad"
          ? await server.prisma.squad.findUnique({ where: { inviteCode } })
          : await server.prisma.company.findUnique({
              where: { inviteCode },
              include: { _count: { select: { memberships: true } } }
            });
      if (!group) {
        return sendError(reply, request, 404, "INVITE_CODE_NOT_FOUND", "Invite code not found");
      }
      if (kind === "squad") {
        await server.prisma.squadMembership.create({ data: { userId, squadId: group.id } });
      } else {
        const company = group as typeof group & { _count: { memberships: number } };
        await server.prisma.companyMembership.create({
          data: {
            userId,
            companyId: group.id,
            anonymousAlias: anonymousAlias(company._count.memberships + 1)
          }
        });
      }
      await auditSocial(server, request, `social.${kind}.joined`, userId, kind, group.id);
      return ok(await socialSummary(server, userId));
    }
  );

  server.delete(
    path,
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const userId = request.user!.id;
      const membership = await currentMembership(server, kind, userId);
      if (kind === "squad") {
        await server.prisma.squadMembership.deleteMany({ where: { userId } });
      } else {
        await server.prisma.companyMembership.deleteMany({ where: { userId } });
      }
      await auditSocial(server, request, `social.${kind}.left`, userId, kind, membership?.groupId);
      return ok(await socialSummary(server, userId));
    }
  );
}

async function socialSummary(server: FastifyInstance, userId: string) {
  const user = await server.prisma.user.update({
    where: { id: userId },
    data: { friendCode: (await server.prisma.user.findUnique({ where: { id: userId }, select: { friendCode: true } }))?.friendCode ?? makeCode() },
    include: {
      friendshipsAsA: { include: { userB: true } },
      friendshipsAsB: { include: { userA: true } },
      squadMembership: { include: { squad: { include: { _count: { select: { memberships: true } } } } } },
      companyMembership: { include: { company: { include: { _count: { select: { memberships: true } } } } } }
    }
  });
  const friends = [
    ...user.friendshipsAsA.map((row) => row.userB),
    ...user.friendshipsAsB.map((row) => row.userA)
  ].map((friend) => ({ userId: friend.id, displayName: friend.displayName }));
  return {
    friendCode: user.friendCode!,
    friends,
    squad: user.squadMembership
      ? {
          id: user.squadMembership.squad.id,
          name: user.squadMembership.squad.name,
          inviteCode: user.squadMembership.squad.inviteCode,
          memberCount: user.squadMembership.squad._count.memberships
        }
      : null,
    company: user.companyMembership
      ? {
          id: user.companyMembership.company.id,
          name: user.companyMembership.company.name,
          inviteCode: user.companyMembership.company.inviteCode,
          anonymousAlias: user.companyMembership.anonymousAlias,
          memberCount: user.companyMembership.company._count.memberships
        }
      : null,
    reactions: { dailyLimit: dailyReactionLimit, resetTimezone: "UTC" }
  };
}

async function currentMembership(server: FastifyInstance, kind: "squad" | "company", userId: string) {
  if (kind === "squad") {
    const row = await server.prisma.squadMembership.findUnique({ where: { userId } });
    return row ? { groupId: row.squadId } : null;
  }
  const row = await server.prisma.companyMembership.findUnique({ where: { userId } });
  return row ? { groupId: row.companyId } : null;
}

async function reactionCounts(server: FastifyInstance, recipientId: string) {
  const grouped = await server.prisma.socialReaction.groupBy({
    by: ["reactionType"],
    where: { recipientId },
    _count: { _all: true }
  });
  return {
    tissue: grouped.find((item) => item.reactionType === SocialReactionType.tissue)?._count._all ?? 0,
    like: grouped.find((item) => item.reactionType === SocialReactionType.like)?._count._all ?? 0
  };
}

async function auditSocial(
  server: FastifyInstance,
  request: FastifyRequest,
  eventType: string,
  targetUserId: string,
  sourceType: string,
  sourceId?: string,
  metadata: Prisma.InputJsonValue = {}
) {
  request.log.info({
    event: eventType,
    actor_user_id: request.user!.id,
    target_user_id: targetUserId,
    request_id: request.trace.requestId,
    trace_id: request.trace.traceId,
    span_id: request.trace.spanId
  });
  await recordAuditEventWithClient(server.prisma, {
    eventType,
    actorUserId: request.user!.id,
    targetUserId,
    sourceType,
    sourceId,
    metadata,
    trace: request.trace
  });
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string
) {
  return reply.code(status).send(fail(code, message, request.trace));
}

export function canonicalPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

export function anonymousAlias(position: number): string {
  return `工位同学 ${position.toString().padStart(2, "0")}`;
}

export function utcDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
