import type { TraceContext } from "../observability/ids.js";

export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  traceId?: string;
};

export type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

export function ok<T>(data: T): ApiEnvelope<T> {
  return {
    data,
    error: null
  };
}

export function fail(
  code: string,
  message: string,
  context?: Pick<TraceContext, "requestId" | "traceId">
): ApiEnvelope<never> {
  return {
    data: null,
    error: {
      code,
      message,
      requestId: context?.requestId,
      traceId: context?.traceId
    }
  };
}
