import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { fail } from "../http/envelope.js";
import { verifySupabaseJwt } from "../security/jwt.js";

export type AuthenticatedUser = {
  id: string;
  authSubject: string;
  email?: string;
  displayName: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export async function registerAuth(server: FastifyInstance) {
  server.decorateRequest("user");
  server.decorate("requireAuth", requireAuth);
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send(fail("UNAUTHENTICATED", "Missing bearer token", request.trace));
  }

  if (!env.SUPABASE_JWT_SECRET) {
    request.log.error({
      event: "auth.misconfigured",
      request_id: request.trace.requestId,
      trace_id: request.trace.traceId
    });
    return reply.code(500).send(fail("AUTH_MISCONFIGURED", "Auth is not configured", request.trace));
  }

  try {
    const payload = verifySupabaseJwt(header.slice("Bearer ".length), env.SUPABASE_JWT_SECRET);

    if (request.server.runtimeConfig.auth.requireEmailVerified && !payload.email_confirmed_at) {
      return reply.code(403).send(fail("EMAIL_NOT_VERIFIED", "Email is not verified", request.trace));
    }

    const user = await request.server.prisma.user.upsert({
      where: { authSubject: payload.sub },
      create: {
        id: payload.sub,
        authSubject: payload.sub,
        email: payload.email,
        displayName: defaultDisplayName(payload.email),
        profile: {
          create: {
            privacyMode: "public_alias"
          }
        },
        stats: {
          create: {}
        }
      },
      update: {
        email: payload.email
      }
    });

    request.user = {
      id: user.id,
      authSubject: user.authSubject,
      email: user.email ?? undefined,
      displayName: user.displayName
    };
  } catch (error) {
    request.log.warn({
      event: "auth.jwt_rejected",
      request_id: request.trace.requestId,
      trace_id: request.trace.traceId,
      err: error
    });
    return reply.code(401).send(fail("UNAUTHENTICATED", "Invalid bearer token", request.trace));
  }
}

function defaultDisplayName(email?: string): string {
  return email?.split("@")[0] || "摸鱼新同学";
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: typeof requireAuth;
  }
}
