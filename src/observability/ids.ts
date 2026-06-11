import { randomUUID } from "node:crypto";

export type TraceContext = {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

export function createRequestId(): string {
  return createId("req");
}

export function createTraceId(): string {
  return createId("trc");
}

export function createSpanId(): string {
  return createId("spn");
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
