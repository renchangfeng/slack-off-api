import type { FastifyReply, FastifyRequest } from "fastify";
import { fail } from "../http/envelope.js";

export function isSelf(request: FastifyRequest, userId: string): boolean {
  return request.user?.id === userId;
}

export async function requireSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string
) {
  if (!isSelf(request, userId)) {
    return reply.code(403).send(fail("FORBIDDEN", "You cannot access this resource", request.trace));
  }
}
