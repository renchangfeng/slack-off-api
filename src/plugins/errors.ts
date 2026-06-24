import type { FastifyInstance } from "fastify";
import { fail } from "../http/envelope.js";

export async function registerErrors(server: FastifyInstance) {
  server.setErrorHandler((error, request, reply) => {
    const normalizedError = toHttpError(error);
    const statusCode = getStatusCode(normalizedError);
    const code = normalizedError.code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");

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

function toHttpError(error: unknown): Error & { statusCode?: number; code?: string } {
  if (error instanceof Error) {
    return error;
  }

  if (isEnvelopeError(error)) {
    const normalized = new Error(error.error.message) as Error & {
      statusCode?: number;
      code?: string;
    };
    normalized.code = error.error.code;
    normalized.statusCode = error.error.code === "RATE_LIMITED" ? 429 : 400;
    return normalized;
  }

  return new Error("Unexpected error");
}

function isEnvelopeError(value: unknown): value is {
  error: { code: string; message: string };
} {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === "object" &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
  );
}
