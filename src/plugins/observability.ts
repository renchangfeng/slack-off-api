import type { FastifyInstance, FastifyRequest } from "fastify";
import { createSpanId, createTraceId, type TraceContext } from "../observability/ids.js";

declare module "fastify" {
  interface FastifyRequest {
    trace: TraceContext;
  }
}

export async function registerObservability(server: FastifyInstance) {
  server.decorateRequest("trace");

  server.addHook("onRequest", async (request, reply) => {
    const traceId = headerValue(request, "x-trace-id") ?? createTraceId();
    const parentSpanId = headerValue(request, "x-parent-span-id");

    request.trace = {
      requestId: request.id,
      traceId,
      spanId: createSpanId(),
      parentSpanId
    };

    reply.header("X-Request-Id", request.trace.requestId);
    reply.header("X-Trace-Id", request.trace.traceId);
  });

  server.addHook("onResponse", async (request, reply) => {
    request.log.info({
      event: "api.request.completed",
      request_id: request.trace.requestId,
      trace_id: request.trace.traceId,
      span_id: request.trace.spanId,
      parent_span_id: request.trace.parentSpanId,
      route: request.routeOptions.url,
      method: request.method,
      status_code: reply.statusCode,
      duration_ms: reply.elapsedTime
    });
  });

  server.addHook("onError", async (request, _reply, error) => {
    request.log.error({
      event: "api.request.failed",
      request_id: request.trace?.requestId ?? request.id,
      trace_id: request.trace?.traceId,
      span_id: request.trace?.spanId,
      route: request.routeOptions.url,
      method: request.method,
      error_code: error.code,
      err: error
    });
  });
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value?.toString();
}
