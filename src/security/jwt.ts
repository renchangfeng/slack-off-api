import { createHmac, timingSafeEqual } from "node:crypto";

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  email_confirmed_at?: string;
  exp?: number;
};

export function verifySupabaseJwt(token: string, secret: string): SupabaseJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8")) as {
    alg?: string;
    typ?: string;
  };

  if (header.alg !== "HS256") {
    throw new Error("Unsupported JWT algorithm");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = base64UrlDecode(encodedSignature);

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("Invalid JWT signature");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as SupabaseJwtPayload;
  if (!payload.sub) {
    throw new Error("JWT subject is missing");
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error("JWT is expired");
  }

  return payload;
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}
