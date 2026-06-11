import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import type { TraceContext } from "../observability/ids.js";

export type AuditEventInput = {
  eventType: string;
  actorUserId?: string;
  targetUserId?: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Prisma.InputJsonValue;
  trace: TraceContext;
};

export async function recordAuditEvent(input: AuditEventInput) {
  return recordAuditEventWithClient(prisma, input);
}

export async function recordAuditEventWithClient(
  client: Pick<typeof prisma, "auditEvent">,
  input: AuditEventInput
) {
  return client.auditEvent.create({
    data: {
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      requestId: input.trace.requestId,
      traceId: input.trace.traceId,
      spanId: input.trace.spanId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      metadata: input.metadata ?? {}
    }
  });
}
