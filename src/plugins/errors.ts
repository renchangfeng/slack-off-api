import type { FastifyInstance } from "fastify";
import { fail } from "../http/envelope.js";

export async function registerErrors(server: FastifyInstance) {
  server.setErrorHandler((error, request, reply) => {
    const normalizedError = toHttpError(error);
    const statusCode = getStatusCode(normalizedError);
    const code = statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";

    request.log.error({
      event: "api.error.response",
      request_id: request.trace?.requestId ?? request.id,
      trace_id: request.trace?.traceId,
      span_id: request.trace?.spanId,
      status_code: statusCode,
      error_code: code,
      err: normalizedError
    });

    return reply.code(statusCode).send(fail(code, normalizedError.message, request.trace));
  });

  server.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(fail("NOT_FOUND", "Route not found", request.trace));
  });
}

function getStatusCode(error: Error & { statusCode?: number }): number {
  return error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
}

function toHttpError(error: unknown): Error & { statusCode?: number } {
  if (error instanceof Error) {
    return error;
  }

  return new Error("Unexpected error");
}
